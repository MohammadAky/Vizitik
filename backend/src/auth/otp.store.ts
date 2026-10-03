import { Injectable } from '@nestjs/common';
import { normalizePhone } from '../common/phone';

export type OtpPurpose = 'register' | 'reset';

export type OtpRecord = {
  code: string;
  expiresAt: number;
  purpose: OtpPurpose;
  deliveredTo?: string;
};

/**
 * Both ends of the confirmation code live here.
 *
 * The code itself is kept in memory on purpose: it is valid for two minutes and a
 * restart invalidating it is the behaviour you want, not a bug.
 *
 * The second map is the reason a new visitor can receive a code at all. A person who
 * is not registered yet has no row in the database, so the server has no Bale chat id
 * to write to. Instead, whenever the bot sees a chat share its phone number we remember
 * that pairing here, and a pending code is delivered into that chat. A code is therefore
 * never copied into the admin chat by default (see the OTP_CC_ADMIN escape hatch in
 * AuthService) - that turned "the code was sent to the applicant" into "the code landed
 * in the owner's inbox and nobody could sign up".
 */
@Injectable()
export class OtpStore {
  private readonly ttlMs = 2 * 60 * 1000;
  private readonly chatTtlMs = 60 * 60 * 1000;
  private readonly pending = new Map<string, OtpRecord>();
  private readonly chats = new Map<string, { chatId: string; at: number }>();

  /** 0912..., 912..., 98912..., +98912... and ۰۹۱۲... are the same number to this store */
  private key(phone: string): string {
    return normalizePhone(phone);
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, rec] of this.pending) if (now > rec.expiresAt) this.pending.delete(k);
    for (const [k, rec] of this.chats) if (now - rec.at > this.chatTtlMs) this.chats.delete(k);
  }

  issue(phone: string, purpose: OtpPurpose): OtpRecord {
    this.prune();
    const rec: OtpRecord = {
      code: String(Math.floor(10000 + Math.random() * 90000)),
      expiresAt: Date.now() + this.ttlMs,
      purpose,
    };
    this.pending.set(this.key(phone), rec);
    return rec;
  }

  peek(phone: string): OtpRecord | null {
    const rec = this.pending.get(this.key(phone));
    if (!rec) return null;
    if (Date.now() > rec.expiresAt) {
      this.pending.delete(this.key(phone));
      return null;
    }
    return rec;
  }

  /** lets the caller tell "never requested" apart from "requested but too late" */
  isExpired(phone: string): boolean {
    const rec = this.pending.get(this.key(phone));
    return !!rec && Date.now() > rec.expiresAt;
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
   * Called by the bot when a chat shares its contact card: if that phone asked for a
   * code a moment ago, hand it over here and mark it delivered.
   */
  claimForChat(phone: string, chatId: string | number): OtpRecord | null {
    const rec = this.peek(phone);
    if (!rec || rec.deliveredTo) return null;
    rec.deliveredTo = String(chatId);
    return rec;
  }
}
