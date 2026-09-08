import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

@Injectable()
export class BaleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BaleService.name);
  private readonly baleToken =
    process.env.BALE_BOT_TOKEN || "2089208057:mqfJ2g1Vbxn-gdtP7e3Lm6T24ou6WK0CuFc";
  private readonly apiUrl = `https://tapi.bale.ai/bot${this.baleToken}`;
  private isPolling = false;
  private lastUpdateId = 0;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.logger.log(
      `🤖 ماژول ربات بله ویزیتیک راه‌اندازی شد (Token: ${this.baleToken.substring(0, 15)}...)`,
    );
    this.startPollingLoop();
  }

  onModuleDestroy() {
    this.isPolling = false;
    this.logger.log("🛑 ربات بله متوقف شد.");
  }

  /**
   * ارسال پیام متنی به چت در بله
   */
  async sendMessage(chatId: string | number, text: string, replyMarkup: any = null) {
    try {
      const payload: any = {
        chat_id: String(chatId),
        text,
        parse_mode: "Markdown",
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }

      const res = await fetch(`${this.apiUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      return await res.json().catch(() => ({}));
    } catch (err: any) {
      this.logger.error(`خطا در ارسال پیام به چت ${chatId}: ${err.message}`);
      return null;
    }
  }

  /**
   * ارسال خودکار و اصولی فاکتور صادر شده به ویزیتور و فروشگاه (مشتری)
   */
  async sendInvoiceNotification(orderId: string, options: { isUpdate?: boolean } = {}) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          customer: {
            include: {
              ledgerEntries: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
          visitor: true,
          items: {
            include: { product: true },
          },
          discountSteps: {
            orderBy: { stepOrder: "asc" },
          },
          payments: {
            include: { check: true },
          },
        },
      });

      if (!order) {
        this.logger.warn(`فاکتور ${orderId} برای ارسال به بله یافت نشد.`);
        return { success: false, reason: "order_not_found" };
      }

      const customer = order.customer;
      const visitor = order.visitor;
      // شمارهٔ فاکتورِ رسمیِ ذخیره‌شده (مثل 1405-000012) — یکسان با رسید چاپی و لیست فاکتورها
      const invNo =
        order.invoiceNumber ||
        (order.localUuid.length > 8 ?
          order.localUuid.substring(0, 8).toUpperCase()
        : order.localUuid);
      const orderDateStr = new Date(order.orderDate).toLocaleDateString("fa-IR", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const subtotalStr = Number(order.subtotalAmount).toLocaleString("fa-IR");
      const discountStr = Number(order.totalDiscountAmount).toLocaleString("fa-IR");
      const finalStr = Number(order.finalAmount).toLocaleString("fa-IR");

      const paidSum = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const paidStr = paidSum.toLocaleString("fa-IR");
      const remainingCredit = Math.max(0, Number(order.finalAmount) - paidSum);
      const remainingCreditStr = remainingCredit.toLocaleString("fa-IR");

      // لیست پرداخت‌ها
      let paymentMethodsList = "";
      if (order.payments.length > 0) {
        paymentMethodsList = order.payments
          .map((p) => {
            if (p.method === "CASH")
              return `▫️ نقدی: ${Number(p.amount).toLocaleString("fa-IR")} تومان`;
            if (p.method === "CARD")
              return `▫️ کارتخوان / پوز: ${Number(p.amount).toLocaleString("fa-IR")} تومان`;
            if (p.method === "CHECK" && p.check) {
              const checkDue = new Date(p.check.dueDate).toLocaleDateString("fa-IR");
              return `▫️ چک صیادی (${p.check.bankName || "بانک"} - سررسید ${checkDue}): ${Number(p.amount).toLocaleString("fa-IR")} تومان`;
            }
            return `▫️ ${p.method}: ${Number(p.amount).toLocaleString("fa-IR")} تومان`;
          })
          .join("\n");
      }

      if (remainingCredit > 0) {
        paymentMethodsList += `\n▫️ مانده نسیه فاکتور: *${remainingCreditStr} تومان*`;
      }

      // لیست اقلام سفارش
      let itemsListText = "";
      if (order.items.length > 0) {
        itemsListText = order.items
          .map((i) => {
            const pName = i.product.name;
            const brand = i.product.brand ? ` (${i.product.brand})` : "";
            const parts: string[] = [];
            if (i.cartonCount > 0) parts.push(`${i.cartonCount} کارتن`);
            if (i.unitCount > 0) parts.push(`${i.unitCount} دانه`);
            const qtyDesc = parts.join(" و ") || "۰";
            const rowPrice = Number(i.lineTotal).toLocaleString("fa-IR");
            return `▫️ ${pName}${brand}: ${qtyDesc} | ${rowPrice} ت`;
          })
          .join("\n");
      }

      // وضعیت بدهی دفتر حساب مشتری
      const latestBalance =
        customer.ledgerEntries.length > 0 ? Number(customer.ledgerEntries[0].balanceAfter) : 0;
      const latestBalanceStr = latestBalance.toLocaleString("fa-IR");
      const debtSection = `\n📊 *وضعیت حساب شما:*\n▫️ مانده کل بدهی نزد ویزیتیک: *${latestBalanceStr} تومان*\n`;

      const updatePrefix = options.isUpdate ? "✏️ *[اصلاحیه فاکتور]*\n" : "";

      // ۱. پیام اختصاصی برای مشتری / فروشگاه
      const customerMessage =
        `${updatePrefix}🧾 *فاکتور رسمی ویزیتیک*\n\n` +
        `🏪 *فروشگاه:* ${customer.name}\n` +
        `🔢 *شماره فاکتور:* #${invNo.replace(/-/g, "_")}\n` +
        `📅 *زمان ثبت:* ${orderDateStr}\n` +
        `👤 *ویزیتور:* #${visitor.firstName}_${visitor.lastName} (${visitor.phone})\n\n` +
        (itemsListText ? `📋 *اقلام فاکتور:*\n${itemsListText}\n\n` : "") +
        `💵 *جمع ناخالص:* ${subtotalStr} تومان\n` +
        (Number(order.totalDiscountAmount) > 0 ? `🎁 *مجموع تخفیف:* ${discountStr} تومان\n` : "") +
        `💰 *مبلغ نهایی قابل پرداخت:* *${finalStr} تومان*\n\n` +
        `💳 *روش تسویه و پرداخت:*\n${paymentMethodsList}\n` +
        debtSection +
        `\n— — —\n` +
        `🤝 *هم‌توزیع‌کننده‌ها را هم به ویزیتیک دعوت کنید*\n` +
        `اگر ویزیتور یا پخش‌کننده‌ی دیگری را می‌شناسید که به این فروشگاه یا محله‌های دیگر سر می‌زند، این ربات را به او معرفی کنید تا سفارش، فاکتور و حسابِ او هم دقیق و منظم در *ویزیتیک* ثبت و همین‌جا در بله ارسال شود.\n` +
        `ربات: ble.ir/HesabchinBot`;

      // ۲. پیام اختصاصی برای ویزیتور
      const visitorMessage =
        `${updatePrefix}📋 *گزارش خودکار فاکتور فروش*\n\n` +
        `🏪 *فروشگاه:* #${customer.name.replace(/\s+/g, "_")}\n` +
        `🔢 *شماره فاکتور:* #${invNo.replace(/-/g, "_")}\n` +
        `💰 *مبلغ فاکتور:* *${finalStr} تومان*\n` +
        `💳 *مبلغ دریافتی:* ${paidStr} تومان\n` +
        (remainingCredit > 0 ?
          `⚠️ *مانده نسیه این فاکتور:* ${remainingCreditStr} تومان\n\n`
        : `✅ *تسویه کامل*\n`) +
        `📊 *مانده کل حساب فروشگاه:* ${latestBalanceStr} تومان\n` +
        (customer.baleChatId ?
          `📲 *فاکتور به صورت خودکار برای فروشگاه در بله ارسال شد.*`
        : `⚠️ *فروشگاه هنوز در ربات بله متصل نشده است.*`);

      let customerSent = false;
      let visitorSent = false;

      // ارسال خودکار به مشتری در بله
      if (customer.baleChatId) {
        const res = await this.sendMessage(customer.baleChatId, customerMessage);
        customerSent = !!(res && res.ok);
        if (customerSent) {
          this.logger.log(
            `✅ فاکتور ${invNo} با موفقیت و به صورت خودکار به بله مشتری [${customer.name}] (${customer.baleChatId}) ارسال شد.`,
          );
        }
      }

      // ارسال خودکار به ویزیتور در بله
      const fallbackChatId = process.env.BALE_ADMIN_CHAT_ID || "542633638";
      const visitorTargetChat = visitor.baleChatId || fallbackChatId;

      if (visitorTargetChat) {
        const res = await this.sendMessage(visitorTargetChat, visitorMessage);
        visitorSent = !!(res && res.ok);
        if (visitorSent) {
          this.logger.log(
            `✅ فاکتور ${invNo} به بله ویزیتور [${visitor.firstName} ${visitor.lastName}] (${visitorTargetChat}) ارسال شد.`,
          );
        }
      }

      return {
        success: true,
        customerSent,
        visitorSent,
        customerLinked: !!customer.baleChatId,
      };
    } catch (err: any) {
      this.logger.error(`خطا در ارسال اعلان فاکتور به بله: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * دریافت تنظیمات و آمار تفکیکی اتصال مشتریان به ربات بله
   */
  async getBaleStatsAndSettings(visitorId: string) {
    const visitor = await this.prisma.user.findUnique({
      where: { id: visitorId },
      include: {
        invoiceSettings: true,
      },
    });

    const customers = await this.prisma.customer.findMany({
      where: { assignedVisitorId: visitorId },
      include: {
        ledgerEntries: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    const linkedCustomers = customers.filter((c) => !!c.baleChatId);
    const unlinkedCustomers = customers.filter((c) => !c.baleChatId);

    const userSettings = visitor?.invoiceSettings[0];

    return {
      botInfo: {
        username: "HesabchinBot",
        link: "https://ble.ir/HesabchinBot",
        status: "ONLINE",
      },
      visitorStatus: {
        isLinked: !!visitor?.baleChatId,
        baleChatId: visitor?.baleChatId || null,
        phone: visitor?.phone || "",
      },
      customersStats: {
        total: customers.length,
        linkedCount: linkedCustomers.length,
        unlinkedCount: unlinkedCustomers.length,
        linkedList: linkedCustomers.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          baleChatId: c.baleChatId,
        })),
        unlinkedList: unlinkedCustomers.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
      },
      settings: {
        baleNotifyCustomer: userSettings?.baleNotifyCustomer ?? true,
        baleNotifyVisitor: userSettings?.baleNotifyVisitor ?? true,
        baleIncludeItems: userSettings?.baleIncludeItems ?? true,
        baleIncludeDebt: userSettings?.baleIncludeDebt ?? true,
      },
    };
  }

  /**
   * ذخیره تنظیمات ارسال اعلان‌های فاکتور به بله
   */
  async updateBaleSettings(
    visitorId: string,
    dto: {
      baleNotifyCustomer?: boolean;
      baleNotifyVisitor?: boolean;
      baleIncludeItems?: boolean;
      baleIncludeDebt?: boolean;
    },
  ) {
    const existing = await this.prisma.invoiceSettings.findFirst({
      where: { userId: visitorId },
    });

    if (existing) {
      const updated = await this.prisma.invoiceSettings.update({
        where: { id: existing.id },
        data: {
          baleNotifyCustomer:
            dto.baleNotifyCustomer !== undefined ?
              dto.baleNotifyCustomer
            : existing.baleNotifyCustomer,
          baleNotifyVisitor:
            dto.baleNotifyVisitor !== undefined ?
              dto.baleNotifyVisitor
            : existing.baleNotifyVisitor,
          baleIncludeItems:
            dto.baleIncludeItems !== undefined ? dto.baleIncludeItems : existing.baleIncludeItems,
          baleIncludeDebt:
            dto.baleIncludeDebt !== undefined ? dto.baleIncludeDebt : existing.baleIncludeDebt,
        },
      });
      return { success: true, settings: updated };
    } else {
      const created = await this.prisma.invoiceSettings.create({
        data: {
          userId: visitorId,
          showDiscountBreakdown: true,
          showVanInventoryRef: false,
          baleNotifyCustomer: dto.baleNotifyCustomer ?? true,
          baleNotifyVisitor: dto.baleNotifyVisitor ?? true,
          baleIncludeItems: dto.baleIncludeItems ?? true,
          baleIncludeDebt: dto.baleIncludeDebt ?? true,
        },
      });
      return { success: true, settings: created };
    }
  }

  /**
   * پردازش آپدیت‌های ورودی از بله (Polling و Webhook)
   */
  async processUpdate(update: any) {
    const message = update?.message || update?.callback_query?.message;
    if (!message) return;

    const chatId = message.chat?.id || message.from?.id;
    if (!chatId) return;

    const fromName =
      `${message.from?.first_name || ""} ${message.from?.last_name || ""}`.trim() || "کاربر گرامی";
    const text = message.text || "";

    this.logger.log(`📩 پیام جدید از [${fromName}] (${chatId}): ${text || "[اشتراک شماره]"}`);

    // ۱. در صورت ارسال /start یا متن
    if (text && !message.contact) {
      const welcomeText =
        `سلام *${fromName}* عزیز؛ 🍦\n` +
        `به ربات رسمی *ویزیتیک* (سامانه توزیع مویرگی و پخش گرم) خوش آمدید.\n\n` +
        `برای اتصال خودکار شماره تلفن شما و دریافت لحظه‌ای فاکتورها، صورت‌حساب و تخفیف‌ها، لطفاً دکمه زیر را لمس نمایید:`;

      const contactKeyboard = {
        keyboard: [
          [
            {
              text: "📱 ارسال و تایید شماره موبایل",
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
      let rawPhone = String(message.contact.phone_number || "").replace(/[^0-9]/g, "");
      let normalizedPhone = rawPhone;

      if (rawPhone.startsWith("98") && rawPhone.length === 12) {
        normalizedPhone = "0" + rawPhone.substring(2);
      } else if (rawPhone.length === 10 && rawPhone.startsWith("9")) {
        normalizedPhone = "0" + rawPhone;
      }

      this.logger.log(`📱 شماره تماس دریافت شد: ${normalizedPhone} (چت‌آیدی: ${chatId})`);

      let matchedRole = "";
      let matchedName = "";

      try {
        // الف: بررسی جدول مشتریان (فروشگاه‌ها)
        const customer = await this.prisma.customer.findFirst({
          where: {
            OR: [
              { phone: normalizedPhone },
              { phone: normalizedPhone.replace(/^0/, "") },
              { phone: "+98" + normalizedPhone.replace(/^0/, "") },
            ],
          },
        });

        if (customer) {
          await this.prisma.customer.update({
            where: { id: customer.id },
            data: { baleChatId: String(chatId) },
          });
          matchedRole = "مشتری";
          matchedName = customer.name;
          this.logger.log(`✅ مشتری [${customer.name}] در دیتابیس به چت‌آیدی ${chatId} متصل شد.`);
        }

        // ب: بررسی جدول ویزیتورها و کاربران
        const user = await this.prisma.user.findFirst({
          where: {
            OR: [{ phone: normalizedPhone }, { phone: normalizedPhone.replace(/^0/, "") }],
          },
        });

        if (user) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { baleChatId: String(chatId) },
          });
          if (!matchedRole) {
            matchedRole = "ویزیتور";
            matchedName = `${user.firstName} ${user.lastName}`;
          }
          this.logger.log(
            `✅ ویزیتور [${user.firstName} ${user.lastName}] به چت‌آیدی ${chatId} متصل شد.`,
          );
        }
      } catch (dbErr: any) {
        this.logger.warn(`خطا در تطبیق دیتابیس: ${dbErr.message}`);
      }

      let confirmationText = "";
      if (matchedRole === "مشتری") {
        confirmationText =
          `✅ *فروشگاه محترم ${matchedName}؛*\n\n` +
          `شماره موبایل شما (*${normalizedPhone}*) با موفقیت تایید و به سیستم ویزیتیک متصل شد.\n` +
          `از این پس فاکتورهای رسمی، ریز اقلام، مانده حساب و جشنواره‌های تخفیف مستقیماً به این صفحه ارسال خواهند شد. 🍦`;
      } else if (matchedRole === "ویزیتور") {
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
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
    }, 1000);
  }

  /**
   * ارسال پیام همگانی/اطلاع‌رسانی به مشتریان از پنل ویزیتور
   */
  async broadcastToCustomers(
    visitorId: string,
    templateText: string,
    targetType: "all" | "debtors" | "single",
    singleCustomerId?: string,
  ) {
    let customers: any[] = [];

    if (targetType === "single" && singleCustomerId) {
      const c = await this.prisma.customer.findUnique({
        where: { id: singleCustomerId },
        include: {
          ledgerEntries: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });
      if (c) customers = [c];
    } else {
      customers = await this.prisma.customer.findMany({
        where: {
          assignedVisitorId: visitorId,
        },
        include: {
          ledgerEntries: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });

      if (targetType === "debtors") {
        customers = customers.filter((c) => {
          const debt = c.ledgerEntries.length > 0 ? Number(c.ledgerEntries[0].balanceAfter) : 0;
          return debt > 0;
        });
      }
    }

    // نام ویزیتور با قالب هشتگ (مثل #فاطمه_اکبری) — همراستا با قالب فاکتور بله
    const visitor = await this.prisma.user.findUnique({
      where: { id: visitorId },
      select: { firstName: true, lastName: true },
    });
    const visitorTag =
      visitor && visitor.firstName ?
        `#${`${visitor.firstName} ${visitor.lastName || ""}`.trim().replace(/\s+/g, "_")}`
      : "";

    const fallbackChatId = process.env.BALE_ADMIN_CHAT_ID || "542633638";
    let sentCount = 0;

    for (const cust of customers) {
      const debt = cust.ledgerEntries.length > 0 ? Number(cust.ledgerEntries[0].balanceAfter) : 0;
      const debtStr = debt > 0 ? `${debt.toLocaleString("fa-IR")} تومان` : "۰ تومان (تسویه)";

      const personalizedText =
        `📢 *پیام اطلاع‌رسانی ویزیتیک*\n\n` +
        templateText
          .replace(/{نام_فروشگاه}/g, cust.name)
          .replace(/{نام_ویزیتور}/g, visitorTag)
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
