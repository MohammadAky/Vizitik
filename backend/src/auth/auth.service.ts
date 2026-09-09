import { Injectable, UnauthorizedException, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { APP } from '../app.config';
import {
  LoginDto,
  SendRegisterOtpDto,
  RegisterWithOtpDto,
  SendResetPasswordOtpDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from './auth.dto';

@Injectable()
export class AuthService {
  // حافظه موقت کدهای تایید OTP (شماره تلفن -> { کد، زمان انقضا })
  private otpStore = new Map<string, { code: string; expiresAt: number }>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwtService: JwtService,
  ) {}

  /**
   * ۱. ورود عادی با شماره موبایل و رمز عبور (بدون نیاز به کد تایید)
   */
  async login(dto: LoginDto) {
    const phone = dto.phone.trim();
    const user = await this.prisma.user.findUnique({
      where: { phone },
    });

    if (!user) {
      throw new UnauthorizedException('شماره تلفن یا رمز عبور اشتباه است.');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('شماره تلفن یا رمز عبور اشتباه است.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('حساب کاربری شما غیرفعال شده است. با پشتیبانی تماس بگیرید.');
    }

    const token = this.jwtService.sign({
      sub: user.id,
      phone: user.phone,
      role: user.role,
      name: `${user.firstName} ${user.lastName}`,
    });

    return {
      message: 'ورود با موفقیت انجام شد',
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
      },
      accessToken: token,
    };
  }

  /**
   * ۲. ارسال کد تایید به بله صرفاً جهت «ثبت‌نام کاربر جدید»
   */
  async sendRegisterOtp(dto: SendRegisterOtpDto) {
    const phone = dto.phone.trim();
    if (!phone) {
      throw new BadRequestException('شماره تلفن الزامی است.');
    }

    // بررسی عدم تکراری بودن شماره
    const existing = await this.prisma.user.findUnique({
      where: { phone },
    });
    if (existing) {
      throw new BadRequestException('این شماره تلفن قبلاً ثبت شده است. لطفاً وارد شوید یا از فراموشی رمز استفاده کنید.');
    }

    // تولید کد ۵ رقمی
    const otpCode = String(Math.floor(10000 + Math.random() * 90000));
    const expiresAt = Date.now() + 2 * 60 * 1000; // ۲ دقیقه

    this.otpStore.set(phone, { code: otpCode, expiresAt });

    // ارسال به ربات پیام‌رسان بله در صورت وجود chatId
    await this.dispatchBaleMessage(phone, otpCode, 'ثبت‌نام ویزیتور جدید');

    return {
      success: true,
      message: 'کد تایید ۵ رقمی صادر و به ربات بله ارسال گردید.',
      ...(process.env.NODE_ENV !== 'production' ? { debugCode: otpCode } : {}),
    };
  }

  /**
   * ۳. تایید کد و تکمیل ثبت‌نام کاربر جدید + ورود خودکار
   */
  async registerWithOtp(dto: RegisterWithOtpDto) {
    const phone = dto.phone.trim();
    const code = dto.code.trim();

    // بررسی کد OTP
    this.validateStoredOtp(phone, code);

    // بررسی مجدد تکراری نبودن شماره
    const existing = await this.prisma.user.findUnique({
      where: { phone },
    });
    if (existing) {
      throw new BadRequestException('این شماره تلفن قبلاً ثبت شده است.');
    }

    // هش کردن پسورد
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone,
        passwordHash,
        baleChatId: dto.baleChatId || null,
        role: 'VISITOR',
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
      },
    });

    const token = this.jwtService.sign({
      sub: user.id,
      phone: user.phone,
      role: user.role,
      name: `${user.firstName} ${user.lastName}`,
    });

    return {
      message: 'ثبت‌نام با موفقیت انجام شد و وارد شدید.',
      user,
      accessToken: token,
    };
  }

  /**
   * ۴. ارسال کد تایید جهت «فراموشی و بازیابی رمز عبور»
   */
  async sendResetPasswordOtp(dto: SendResetPasswordOtpDto) {
    const phone = dto.phone.trim();
    if (!phone) {
      throw new BadRequestException('شماره تلفن الزامی است.');
    }

    const user = await this.prisma.user.findUnique({
      where: { phone },
    });
    if (!user) {
      throw new NotFoundException('کاربری با این شماره تلفن در سامانه یافت نشد.');
    }

    const otpCode = String(Math.floor(10000 + Math.random() * 90000));
    const expiresAt = Date.now() + 2 * 60 * 1000;

    this.otpStore.set(phone, { code: otpCode, expiresAt });

    await this.dispatchBaleMessage(phone, otpCode, 'بازیابی رمز عبور', (user as any)?.baleChatId);

    return {
      success: true,
      message: 'کد تایید بازیابی رمز عبور به پیام‌رسان بله ارسال شد.',
      ...(process.env.NODE_ENV !== 'production' ? { debugCode: otpCode } : {}),
    };
  }

  /**
   * ۵. ریست رمز عبور با کد OTP
   */
  async resetPasswordWithOtp(dto: ResetPasswordDto) {
    const phone = dto.phone.trim();
    const code = dto.code.trim();

    this.validateStoredOtp(phone, code);

    const user = await this.prisma.user.findUnique({
      where: { phone },
    });
    if (!user) {
      throw new NotFoundException('کاربری با این شماره تلفن یافت نشد.');
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash },
    });

    return {
      success: true,
      message: 'رمز عبور با موفقیت به‌روزرسانی شد. اکنون می‌توانید وارد شوید.',
    };
  }

  /**
   * ۶. تغییر رمز عبور مستقیم از پنل تنظیمات کاربر
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('کاربر یافت نشد.');
    }

    if (dto.currentPassword) {
      const isMatch = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!isMatch) {
        throw new BadRequestException('رمز عبور فعلی اشتباه است.');
      }
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    return {
      success: true,
      message: 'رمز عبور با موفقیت به‌روزرسانی شد.',
    };
  }

  async updateProfile(userId: string, dto: { firstName?: string; lastName?: string; baleChatId?: string }) {
    const updateData: any = {};
    if (dto.firstName !== undefined) updateData.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) updateData.lastName = dto.lastName.trim();
    if (dto.baleChatId !== undefined) updateData.baleChatId = dto.baleChatId.trim();

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        baleChatId: true,
        role: true,
      },
    });

    return {
      success: true,
      message: 'اطلاعات پروفایل و شناسه بله با موفقیت در دیتابیس به‌روزرسانی شد.',
      user: updatedUser,
    };
  }

  /**
   * پردازش وب‌هوک بله: دریافت استارت و اشتراک‌گذاری شماره موبایل مشتری یا ویزیتور
   * و اتصال خودکار شماره به دیتابیس SQL بدون نیاز به وارد کردن دستی Chat ID
   */
  async handleBaleWebhook(body: any) {
    const baleToken = process.env.BALE_BOT_TOKEN || '2089208057:mqfJ2g1Vbxn-gdtP7e3Lm6T24ou6WK0CuFc';
    const message = body?.message || body?.callback_query?.message;
    if (!message) return { ok: true };

    const chatId = message?.chat?.id || message?.from?.id;
    if (!chatId) return { ok: true };

    // ۱. اگر کاربر /start زد یا پیامی فرستاد
    if (message.text && !message.contact) {
      const welcomeText =
        `🍦 *به سامانه اطلاع‌رسانی و پخش ${APP.nameFa} خوش آمدید*\n\n` +
        `برای اتصال خودکار شماره شما و دریافت لحظه‌ای فاکتورها، مانده حساب و جشنواره‌های تخفیف، لطفاً دکمه «📱 ارسال شماره موبایل» زیر را لمس نمایید:`;

      await fetch(`https://tapi.bale.ai/bot${baleToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: welcomeText,
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [
              [
                {
                  text: '📱 ارسال و تایید شماره موبایل',
                  request_contact: true,
                },
              ],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }),
      }).catch(() => {});

      return { ok: true };
    }

    // ۲. دریافت شماره موبایل اشتراک‌گذاری شده از طرف کاربر
    if (message.contact) {
      let phone = String(message.contact.phone_number || '').replace(/[^0-9]/g, '');
      if (phone.startsWith('98') && phone.length === 12) {
        phone = '0' + phone.substring(2);
      } else if (phone.length === 10 && phone.startsWith('9')) {
        phone = '0' + phone;
      }

      let matchedRole = '';
      let matchedName = '';

      // بررسی در جدول مشتریان (فروشگاه‌ها)
      const customer = await this.prisma.customer.findFirst({
        where: {
          OR: [
            { phone: phone },
            { phone: phone.replace(/^0/, '') },
            { phone: '+98' + phone.replace(/^0/, '') },
          ],
        },
      });

      if (customer) {
        await this.prisma.customer.update({
          where: { id: customer.id },
          data: { baleChatId: String(chatId) },
        });
        matchedRole = 'مشتری';
        matchedName = customer.name;
      }

      // بررسی در جدول ویزیتورها و کاربران
      const user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { phone: phone },
            { phone: phone.replace(/^0/, '') },
          ],
        },
      });

      if (user) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { baleChatId: String(chatId) },
        });
        if (!matchedRole) {
          matchedRole = 'ویزیتور';
          matchedName = `${user.firstName} ${user.lastName}`;
        }
      }

      let replyMsg = '';
      if (matchedRole === 'مشتری') {
        replyMsg =
          `✅ *فروشگاه محترم ${matchedName}؛*\n\n` +
          `شماره شما (${phone}) با موفقیت تایید و به سیستم ${APP.nameFa} متصل شد.\n` +
          `از این پس صورت‌حساب‌ها، مانده حساب و جشنواره‌های تخفیف مستقیماً به این صفحه ارسال خواهند شد. 🍦`;
      } else if (matchedRole === 'ویزیتور') {
        replyMsg =
          `✅ *ویزیتور گرامی (${matchedName})؛*\n\n` +
          `اکانت بله شما با موفقیت به سیستم متصل شد.\n` +
          `تمامی فاکتورها، گزارش‌های فروش و کدهای ورود به این چت ارسال خواهند شد. 🚀`;
      } else {
        replyMsg =
          `✅ شماره موبایل شما (${phone}) در سامانه تایید شد.\n` +
          `به محض صدور فاکتور یا ثبت فروشگاه توسط ویزیتور، اعلان‌ها برای شما فعال خواهند شد.`;
      }

      await fetch(`https://tapi.bale.ai/bot${baleToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyMsg,
          parse_mode: 'Markdown',
          reply_markup: {
            remove_keyboard: true,
          },
        }),
      }).catch(() => {});
    }

    return { ok: true };
  }

  // ============================================================
  // متدهای کمکی داخلی
  // ============================================================

  private validateStoredOtp(phone: string, code: string) {
    const stored = this.otpStore.get(phone);
    if (!stored) {
      throw new BadRequestException('کد تایید منقضی شده یا درخواستی ثبت نشده است. لطفاً مجدداً درخواست کد دهید.');
    }

    if (Date.now() > stored.expiresAt) {
      this.otpStore.delete(phone);
      throw new BadRequestException('کد تایید منقضی شده است.');
    }

    if (stored.code !== code) {
      throw new BadRequestException('کد تایید وارد شده نادرست است.');
    }

    this.otpStore.delete(phone);
  }

  /**
   * برودکست پیام آنلاین شدن سرور به تمام کاربران ثبت‌شده در بله
   */
  async broadcastServerOnline() {
    const baleToken = process.env.BALE_BOT_TOKEN || '2089208057:mqfJ2g1Vbxn-gdtP7e3Lm6T24ou6WK0CuFc';
    if (!baleToken) return;

    try {
      const users = await this.prisma.user.findMany({
        where: {
          baleChatId: { not: null },
        },
      });

      const nowStr = new Intl.DateTimeFormat('fa-IR', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Tehran',
      }).format(new Date());

      const text = `🍦 *سامانه جامع پخش گرم ${APP.nameFa}*\n\n` +
                   `🚀 *سرور بک‌اند آنلاین شد!*\n` +
                   `⏱ *زمان:* ${nowStr}\n` +
                   `✅ *وضعیت:* آماده صدور فاکتور و ثبت وصولی`;

      const adminChatId = process.env.BALE_ADMIN_CHAT_ID || '542633638';
      const targetChatIds = new Set<string>();

      users.forEach(u => {
        if (u.baleChatId) targetChatIds.add(u.baleChatId);
      });
      if (adminChatId) {
        targetChatIds.add(adminChatId);
      }

      for (const chatId of targetChatIds) {
        try {
          await fetch(`https://tapi.bale.ai/bot${baleToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              parse_mode: 'Markdown',
            }),
          });
        } catch (e) {
          console.error(`خطا در ارسال پیام آنلاین شدن به ${chatId}:`, e);
        }
      }
      console.log(`📡 پیام روشن شدن بک‌اند به کاربران بله (${targetChatIds.size} چت) ارسال شد.`);
    } catch (err) {
      console.error('خطا در ارسال پیام آغازین بله:', err);
    }
  }

  private async dispatchBaleMessage(phone: string, code: string, actionTitle: string, chatId?: string | null) {
    const baleToken = process.env.BALE_BOT_TOKEN || '2089208057:mqfJ2g1Vbxn-gdtP7e3Lm6T24ou6WK0CuFc';
    const targetChat = chatId || process.env.BALE_ADMIN_CHAT_ID || '542633638';

    if (targetChat) {
      try {
        const text = `🍦 *${APP.nameFa} — ${actionTitle}*\n\n` +
                     `کد تایید شما:\n` +
                     `👉 \`${code}\` 👈\n\n` +
                     `⏱ این کد به مدت ۲ دقیقه معتبر است.\n` +
                     `⚠️ این پیام را در اختیار دیگران قرار ندهید.`;

        await fetch(`https://tapi.bale.ai/bot${baleToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetChat,
            text,
            parse_mode: 'Markdown',
          }),
        });
      } catch (err) {
        console.error('خطا در ارسال پیام به بله:', err);
      }
    }
  }
}
