/**
 * ============================================================
 * اسکریپت اختصاصی و مستقل ربات بله (Bale Bot Poller)
 * ============================================================
 * این اسکریپت به صورت Long-Polling به سرورهای بله متصل شده،
 * پیام‌های ارسالی کاربران و استارت را دریافت کرده و دکمه
 * «📱 ارسال و تایید شماره موبایل» را نمایش می‌دهد.
 *
 * نحوه اجرا:
 * node bale_bot.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BALE_TOKEN = process.env.BALE_BOT_TOKEN || '2089208057:mqfJ2g1Vbxn-gdtP7e3Lm6T24ou6WK0CuFc';
const BALE_API_URL = `https://tapi.bale.ai/bot${BALE_TOKEN}`;

let lastUpdateId = 0;

console.log('🤖 --------------------------------------------------');
console.log('🚀 ربات بله حساب‌چین در حال راه‌اندازی است...');
console.log(`🔑 توکن ربات: ${BALE_TOKEN.substring(0, 15)}...`);
console.log('--------------------------------------------------');

// متد ارسال پیام به بله
async function sendMessage(chatId, text, replyMarkup = null) {
  try {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    const res = await fetch(`${BALE_API_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    return data;
  } catch (err) {
    console.error(`❌ خطا در ارسال پیام به چت ${chatId}:`, err.message);
    return null;
  }
}

// پردازش هر آپدیت دریافتی
async function processUpdate(update) {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat?.id || message.from?.id;
  const fromName = `${message.from?.first_name || ''} ${message.from?.last_name || ''}`.trim() || 'کاربر گرامی';
  const text = message.text || '';

  console.log(`📩 پیام جدید از [${fromName}] (چت‌آیدی: ${chatId}): ${text || '[اشتراک شماره]'}`);

  // ۱. اگر کاربر پیام متنی یا دستور /start فرستاد
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

    await sendMessage(chatId, welcomeText, contactKeyboard);
    console.log(`📤 دکمه درخواست شماره تماس برای [${chatId}] ارسال شد.`);
    return;
  }

  // ۲. اگر کاربر شماره تماس خود را ارسال کرد
  if (message.contact) {
    let rawPhone = String(message.contact.phone_number || '').replace(/[^0-9]/g, '');
    let normalizedPhone = rawPhone;

    if (rawPhone.startsWith('98') && rawPhone.length === 12) {
      normalizedPhone = '0' + rawPhone.substring(2);
    } else if (rawPhone.length === 10 && rawPhone.startsWith('9')) {
      normalizedPhone = '0' + rawPhone;
    }

    console.log(`📱 شماره تماس دریافت شد: ${normalizedPhone} (چت‌آیدی: ${chatId})`);

    let matchedRole = '';
    let matchedName = '';

    try {
      // الف: بررسی در جدول مشتریان (فروشگاه‌ها)
      const customer = await prisma.customer.findFirst({
        where: {
          OR: [
            { phone: normalizedPhone },
            { phone: normalizedPhone.replace(/^0/, '') },
            { phone: '+98' + normalizedPhone.replace(/^0/, '') },
          ],
        },
      });

      if (customer) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { baleChatId: String(chatId) },
        });
        matchedRole = 'مشتری';
        matchedName = customer.name;
        console.log(`✅ مشتری [${customer.name}] در دیتابیس به چت‌آیدی ${chatId} متصل شد.`);
      }

      // ب: بررسی در جدول ویزیتورها و کاربران
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { phone: normalizedPhone },
            { phone: normalizedPhone.replace(/^0/, '') },
          ],
        },
      });

      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { baleChatId: String(chatId) },
        });
        if (!matchedRole) {
          matchedRole = 'ویزیتور';
          matchedName = `${user.firstName} ${user.lastName}`;
        }
        console.log(`✅ ویزیتور [${user.firstName} ${user.lastName}] در دیتابیس به چت‌آیدی ${chatId} متصل شد.`);
      }
    } catch (dbErr) {
      console.error('⚠️ خطا در اتصال به دیتابیس (بررسی بدون دیتابیس ادامه می‌یابد):', dbErr.message);
    }

    let confirmationText = '';
    if (matchedRole === 'مشتری') {
      confirmationText =
        `✅ *فروشگاه محترم ${matchedName}؛*\n\n` +
        `شماره موبایل شما (*${normalizedPhone}*) با موفقیت تایید و به سیستم متصل شد.\n` +
        `از این پس صورت‌حساب‌ها، فاکتورهای پخش گرم و جشنواره‌های تخفیف مستقیماً به این صفحه ارسال خواهند شد. 🍦`;
    } else if (matchedRole === 'ویزیتور') {
      confirmationText =
        `✅ *ویزیتور گرامی (${matchedName})؛*\n\n` +
        `اکانت بله شما با موفقیت متصل شد.\n` +
        `تمامی فاکتورهای صادره، گزارش‌های فروش و کدهای ورود به این چت ارسال خواهند شد. 🚀`;
    } else {
      confirmationText =
        `✅ شماره موبایل شما (*${normalizedPhone}*) با موفقیت در سیستم تایید شد.\n\n` +
        `به محض ثبت فاکتور یا تعریف فروشگاه شما توسط ویزیتور، اعلان‌ها در این چت فعال خواهند شد. ✨`;
    }

    const removeKeyboard = { remove_keyboard: true };
    await sendMessage(chatId, confirmationText, removeKeyboard);
    console.log(`🎉 پیام تاییدیه اتصال برای [${normalizedPhone}] ارسال شد.`);
  }
}

// حلقه دائمی دریافت پیام‌ها (Long-Polling)
async function startPolling() {
  console.log('📡 در حال گوش دادن به پیام‌های ورودی از بله (Long-Polling)...');

  while (true) {
    try {
      const url = `${BALE_API_URL}/getUpdates?offset=${lastUpdateId + 1}&timeout=20`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));

      if (data && data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          lastUpdateId = Math.max(lastUpdateId, update.update_id);
          await processUpdate(update);
        }
      }
    } catch (err) {
      // در صورت خطای شبکه چند ثانیه صبر و تلاش مجدد
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

startPolling();
