import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class BaleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BaleService.name);
  private readonly baleToken = process.env.BALE_BOT_TOKEN || '2089208057:mqfJ2g1Vbxn-gdtP7e3Lm6T24ou6WK0CuFc';
  private readonly apiUrl = `https://tapi.bale.ai/bot${this.baleToken}`;
  private isPolling = false;
  private lastUpdateId = 0;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.logger.log(`🤖 ماژول ربات بله حساب‌چین راه‌اندازی شد (Token: ${this.baleToken.substring(0, 15)}...)`);
    // اجرای شنونده Polling در پس‌زمینه بدون بلاک کردن استارت‌آپ سرور
    this.startPollingLoop();
  }

  onModuleDestroy() {
    this.isPolling = false;
    this.logger.log('🛑 ربات بله متوقف شد.');
  }

  /**
   * ارسال پیام متنی به چت در بله
   */
  async sendMessage(chatId: string | number, text: string, replyMarkup: any = null) {
    try {
      const payload: any = {
        chat_id: String(chatId),
        text,
        parse_mode: 'Markdown',
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }

      const res = await fetch(`${this.apiUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      return await res.json().catch(() => ({}));
    } catch (err: any) {
      this.logger.error(`خطا در ارسال پیام به چت ${chatId}: ${err.message}`);
      return null;
    }
  }

  /**
   * پردازش آپدیت‌های ورودی از بله (چه از طریق Polling و چه از طریق Webhook)
   */
  async processUpdate(update: any) {
    const message = update?.message || update?.callback_query?.message;
    if (!message) return;

    const chatId = message.chat?.id || message.from?.id;
    if (!chatId) return;

    const fromName = `${message.from?.first_name || ''} ${message.from?.last_name || ''}`.trim() || 'کاربر گرامی';
    const text = message.text || '';

    this.logger.log(`📩 پیام جدید از [${fromName}] (${chatId}): ${text || '[اشتراک شماره]'}`);

    // ۱. در صورت ارسال /start یا متن
    if (text && !message.contact) {
      const welcomeText =
        `سلام *${fromName}* عزیز؛ 🍦\n` +
        `به ربات رسمی *حساب‌چین* (سامانه توزیع مویرگی و پخش گرم) خوش آمدید.\n\n` +
        `برای اتصال خودکار شماره تلفن شما و دریافت لحظه‌ای فاکتورها، صورت‌حساب و تخفیف‌ها، لطفاً دکمه زیر را لمس نمایید:`;

      const contactKeyboard = {
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
      };

      await this.sendMessage(chatId, welcomeText, contactKeyboard);
      return;
    }

    // ۲. در صورت اشتراک‌گذاری شماره موبایل (Contact)
    if (message.contact) {
      let rawPhone = String(message.contact.phone_number || '').replace(/[^0-9]/g, '');
      let normalizedPhone = rawPhone;

      if (rawPhone.startsWith('98') && rawPhone.length === 12) {
        normalizedPhone = '0' + rawPhone.substring(2);
      } else if (rawPhone.length === 10 && rawPhone.startsWith('9')) {
        normalizedPhone = '0' + rawPhone;
      }

      this.logger.log(`📱 شماره تماس دریافت شد: ${normalizedPhone} (چت‌آیدی: ${chatId})`);

      let matchedRole = '';
      let matchedName = '';

      try {
        // الف: بررسی جدول مشتریان (فروشگاه‌ها)
        const customer = await this.prisma.customer.findFirst({
          where: {
            OR: [
              { phone: normalizedPhone },
              { phone: normalizedPhone.replace(/^0/, '') },
              { phone: '+98' + normalizedPhone.replace(/^0/, '') },
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
          this.logger.log(`✅ مشتری [${customer.name}] در دیتابیس به چت‌آیدی ${chatId} متصل شد.`);
        }

        // ب: بررسی جدول ویزیتورها و کاربران
        const user = await this.prisma.user.findFirst({
          where: {
            OR: [
              { phone: normalizedPhone },
              { phone: normalizedPhone.replace(/^0/, '') },
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
          this.logger.log(`✅ ویزیتور [${user.firstName} ${user.lastName}] به چت‌آیدی ${chatId} متصل شد.`);
        }
      } catch (dbErr: any) {
        this.logger.warn(`خطا در تطبیق دیتابیس: ${dbErr.message}`);
      }

      let confirmationText = '';
      if (matchedRole === 'مشتری') {
        confirmationText =
          `✅ *فروشگاه محترم ${matchedName}؛*\n\n` +
          `شماره موبایل شما (*${normalizedPhone}*) با موفقیت تایید و به سیستم حساب‌چین متصل شد.\n` +
          `از این پس فاکتورهای پخش گرم، مانده حساب و جشنواره‌های تخفیف مستقیماً به این صفحه ارسال خواهند شد. 🍦`;
      } else if (matchedRole === 'ویزیتور') {
        confirmationText =
          `✅ *ویزیتور گرامی (${matchedName})؛*\n\n` +
          `اکانت بله شما با موفقیت متصل شد.\n` +
          `تمامی فاکتورهای صادره، گزارش‌های فروش و کدهای ورود به این چت ارسال خواهند شد. 🚀`;
      } else {
        confirmationText =
          `✅ شماره موبایل شما (*${normalizedPhone}*) با موفقیت در سیستم تایید شد.\n\n` +
          `به محض صدور فاکتور یا تعریف فروشگاه شما توسط ویزیتور، اعلان‌ها در این چت فعال خواهند شد. ✨`;
      }

      const removeKeyboard = { remove_keyboard: true };
      await this.sendMessage(chatId, confirmationText, removeKeyboard);
    }
  }

  /**
   * حلقه Long-Polling خودکار در پس‌زمینه سرور
   */
  private async startPollingLoop() {
    this.isPolling = true;

    // اجرای پروسه پس‌زمینه به صورت غیرهمگام
    setTimeout(async () => {
      while (this.isPolling) {
        try {
          const url = `${this.apiUrl}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=10`;
          const res = await fetch(url);
          const data: any = await res.json().catch(() => ({}));

          if (data && data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
              await this.processUpdate(update);
            }
          }
        } catch (err) {
          // در صورت قطعی شبکه چند ثانیه صبر و تلاش مجدد
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
    }, 1000);
  }

  /**
   * ارسال پیام همگانی/اطلاع‌رسانی به مشتریان از پنل ویزیتور
   */
  async broadcastToCustomers(visitorId: string, templateText: string, targetType: 'all' | 'debtors' | 'single', singleCustomerId?: string) {
    let customers: any[] = [];

    if (targetType === 'single' && singleCustomerId) {
      const c = await this.prisma.customer.findUnique({
        where: { id: singleCustomerId },
        include: {
          ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      if (c) customers = [c];
    } else {
      customers = await this.prisma.customer.findMany({
        where: {
          assignedVisitorId: visitorId,
        },
        include: {
          ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      if (targetType === 'debtors') {
        customers = customers.filter((c) => {
          const debt = c.ledgerEntries.length > 0 ? Number(c.ledgerEntries[0].balanceAfter) : 0;
          return debt > 0;
        });
      }
    }

    const fallbackChatId = process.env.BALE_ADMIN_CHAT_ID || '542633638';
    let sentCount = 0;

    for (const cust of customers) {
      const debt = cust.ledgerEntries.length > 0 ? Number(cust.ledgerEntries[0].balanceAfter) : 0;
      const debtStr = debt > 0 ? `${debt.toLocaleString('fa-IR')} تومان` : '۰ تومان (تسویه)';

      const personalizedText = `📢 *پیام اطلاع‌رسانی حساب‌چین*\n\n` +
        templateText
          .replace(/{نام_فروشگاه}/g, cust.name)
          .replace(/{مبلغ_بدهی}/g, debtStr);

      const targetChatId = cust.baleChatId || fallbackChatId;
      if (targetChatId) {
        await this.sendMessage(targetChatId, personalizedText);
        sentCount++;
      }
    }

    return {
      success: true,
      message: `پیام به ${sentCount} مخاطب در بله ارسال شد.`,
      sentCount,
    };
  }
}
