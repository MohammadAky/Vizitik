import { Injectable } from '@nestjs/common';
import { normalizePhone } from '../common/phone';

export type OtpPurpose = 'register' | 'reset';

export type OtpRecord = {
  /**
   * null until the code has actually been handed to a Bale chat. A request that is
   * still waiting for its owner carries no code, so nothing can be typed - and
   * nothing can leak - before the message is on its way.
   */
  code: string | null;
  requestedAt: number;
  /** when a sent code stops being valid; 0 until one is minted */
  expiresAt: number;
  purpose: OtpPurpose;
  deliveredTo?: string;
};

/** claimForChat always mints before it returns, so its code is never null */
export type DeliveredOtp = OtpRecord & { code: string };

/**
 * Both ends of the confirmation code live here.
 *
 * The code itself is kept in memory on purpose: it is valid for two minutes and a
 * restart invalidating it is the behaviour you want, not a bug.
 *
 * There are two separate lifetimes, and mixing them up is what broke signups:
 *
 *   REQUEST  - the app asked for a code, but the visitor has not shared their number
 *              in the bot yet, so there is no chat to write to. Nothing is generated
 *              during this time, only the request waits (requestTtlMs).
 *   CODE     - minted at the moment of delivery and valid for the standard two
 *              minutes from then (ttlMs). Counting from the request punished the
 *              visitor for the time spent opening Bale: the bot received the number
 *              and said nothing, which looked like "the code was never sent".
 *
 * The second map is the reason a new visitor can receive a code at all. A person who
 * is not registered yet has no row in the database, so the server has no Bale chat id
 * to write to. Instead, whenever the bot sees a chat share its phone number we remember
 * that pairing here, and a pending code is delivered into that chat. A code is therefore
 * never copied into the admin chat by default (see the OTP_CC_ADMIN escape hatch in
 * AuthService) - that turned "the code was sent to the applicant" into "the code landed
 * in the owner's inbox and nobody could sign up".
 *
 * Both maps are RAM only: an unregistered number is NOT written to the database.
 */
@Injectable()
export class OtpStore {
  /** a delivered code: the standard two minutes to read it and type it in the app */
  private readonly ttlMs = 2 * 60 * 1000;
  /** how long a request waits for its owner to reach the bot (no code exists yet) */
  private readonly requestTtlMs = 10 * 60 * 1000;
  private readonly chatTtlMs = 60 * 60 * 1000;
  private readonly pending = new Map<string, OtpRecord>();
  private readonly chats = new Map<string, { chatId: string; at: number }>();

  /** 0912..., 912..., 98912..., +98912... and ۰۹۱۲... are the same number to this store */
  private key(phone: string): string {
    return normalizePhone(phone);
  }

  /** while a request is waiting there is no code, so only its age is checked */
  private waiting(rec: OtpRecord, now: number): boolean {
    return now - rec.requestedAt <= this.requestTtlMs;
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, rec] of this.pending) {
      const dead = rec.code ? now > rec.expiresAt : !this.waiting(rec, now);
      if (dead) this.pending.delete(k);
    }
    for (const [k, rec] of this.chats) if (now - rec.at > this.chatTtlMs) this.chats.delete(k);
  }

  /** The app asked for a code. No code is generated here - only when it can be sent. */
  issue(phone: string, purpose: OtpPurpose): OtpRecord {
    this.prune();
    const rec: OtpRecord = {
      code: null,
      requestedAt: Date.now(),
      expiresAt: 0,
      purpose,
    };
    this.pending.set(this.key(phone), rec);
    return rec;
  }

  /** the code going out now; its two minutes start here, at delivery */
  private mint(rec: OtpRecord): string {
    rec.code = String(Math.floor(10000 + Math.random() * 90000));
    rec.expiresAt = Date.now() + this.ttlMs;
    return rec.code;
  }

  /**
   * Whatever can be checked against what the visitor types: the request while it is
   * still waiting (code stays null), or the sent code while its two minutes hold.
   * A code that timed out is dropped, so "expired" and "never asked" stay tellable.
   */
  peek(phone: string): OtpRecord | null {
    const rec = this.pending.get(this.key(phone));
    if (!rec) return null;
    const now = Date.now();
    if (rec.code) {
      if (now > rec.expiresAt) {
        this.pending.delete(this.key(phone));
        return null;
      }
      return rec;
    }
    if (!this.waiting(rec, now)) {
      this.pending.delete(this.key(phone));
      return null;
    }
    return rec;
  }

  /** lets the caller tell "never requested" apart from "requested but too late" */
  isExpired(phone: string): boolean {
    const rec = this.pending.get(this.key(phone));
    if (!rec) return false;
    const now = Date.now();
    return rec.code ? now > rec.expiresAt : !this.waiting(rec, now);
  }

  consume(phone: string): void {
    this.pending.delete(this.key(phone));
  }

  rememberChat(phone: string, chatId: string | number): void {
    if (!chatId) return;
    this.chats.set(this.key(phone), { chatId: String(chatId), at: Date.now() });
  }

  chatFor(phone: string): string | null {
    const rec = this.chats.get(this.key(phone));
    if (!rec) return null;
    if (Date.now() - rec.at > this.chatTtlMs) {
      this.chats.delete(this.key(phone));
      return null;
    }
    return rec.chatId;
  }

  /**
   * Called by the bot when a chat shares its contact card - and by the app when it
   * already knows that chat. This is where the code is born: a pending request is
   * turned into a code, marked delivered and given its two minutes.
   *
   * Returning null means "nothing to hand over": no request, a request that gave up
   * waiting, or a code that already went to its owner (sharing the number twice must
   * not resend it).
   */
  claimForChat(phone: string, chatId: string | number): DeliveredOtp | null {
    const rec = this.pending.get(this.key(phone));
    if (!rec || rec.deliveredTo) return null;
    if (!this.waiting(rec, Date.now())) {
      this.pending.delete(this.key(phone));
      return null;
    }
    this.mint(rec);
    rec.deliveredTo = String(chatId);
    return rec as DeliveredOtp;
  }

  /**
   * The message could not be handed over (blocked bot, wrong chat, network): throw
   * the code away - it never reached anyone - and leave the request open so the next
   * time the number is shared a fresh code is minted for it.
   */
  releaseClaim(phone: string): void {
    const rec = this.pending.get(this.key(phone));
    if (!rec) return;
    delete rec.deliveredTo;
    rec.code = null;
    rec.expiresAt = 0;
    if (!this.waiting(rec, Date.now())) this.pending.delete(this.key(phone));
  }
}
