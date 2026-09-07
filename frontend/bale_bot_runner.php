<?php
/**
 * ============================================================
 * اسکریپت اجرایی ربات بله با PHP (CLI Polling)
 * ============================================================
 * نحوه اجرا در ترمینال:
 * php bale_bot_runner.php
 */

set_time_limit(0);
error_reporting(E_ALL);

$baleToken = "2089208057:mqfJ2g1Vbxn-gdtP7e3Lm6T24ou6WK0CuFc";
$apiUrl = "https://tapi.bale.ai/bot{$baleToken}";

echo "🤖 --------------------------------------------------\n";
echo "🚀 ربات بله حساب‌چین در حال اجرا است...\n";
echo "🔑 توکن: " . substr($baleToken, 0, 15) . "...\n";
echo "📡 در حال گوش دادن به پیام‌ها (برای توقف Ctrl+C بزنید)\n";
echo "--------------------------------------------------\n";

$lastOffset = 0;

function sendBaleMessage($chatId, $text, $replyMarkup = null) {
    global $apiUrl;
    $payload = [
        'chat_id' => $chatId,
        'text' => $text,
        'parse_mode' => 'Markdown'
    ];
    if ($replyMarkup) {
        $payload['reply_markup'] = $replyMarkup;
    }

    $ch = curl_init("{$apiUrl}/sendMessage");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    $res = curl_exec($ch);
    curl_close($ch);
    return json_decode($res, true);
}

while (true) {
    $url = "{$apiUrl}/getUpdates?offset=" . ($lastOffset + 1) . "&timeout=15";
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 25);
    $response = curl_exec($ch);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($response) {
        $data = json_decode($response, true);
        if (!empty($data['ok']) && !empty($data['result']) && is_array($data['result'])) {
            foreach ($data['result'] as $update) {
                $lastOffset = max($lastOffset, $update['update_id']);
                $msg = $update['message'] ?? null;
                if (!$msg) continue;

                $chatId = $msg['chat']['id'] ?? ($msg['from']['id'] ?? null);
                $userName = ($msg['from']['first_name'] ?? '') . ' ' . ($msg['from']['last_name'] ?? '');
                $text = $msg['text'] ?? '';

                echo "📩 پیام از [{$userName}] ({$chatId}): " . ($text ?: '[اشتراک شماره]') . "\n";

                // ۱. دریافت متن یا دستور /start
                if (!empty($text) && empty($msg['contact'])) {
                    $welcome = "سلام *{$userName}* عزیز؛ 🍦\n" .
                               "به ربات رسمی *حساب‌چین* (سامانه توزیع مویرگی و پخش گرم) خوش آمدید.\n\n" .
                               "برای اتصال خودکار شماره تلفن شما و دریافت لحظه‌ای فاکتورها و تخفیف‌ها، لطفاً دکمه زیر را لمس نمایید:";

                    $keyboard = [
                        'keyboard' => [
                            [
                                [
                                    'text' => '📱 ارسال و تایید شماره موبایل',
                                    'request_contact' => true
                                ]
                            ]
                        ],
                        'resize_keyboard' => true,
                        'one_time_keyboard' => true
                    ];

                    sendBaleMessage($chatId, $welcome, $keyboard);
                    echo "📤 دکمه درخواست شماره تماس ارسال شد.\n";
                }

                // ۲. دریافت شماره موبایل اشتراک‌گذاری شده
                if (!empty($msg['contact'])) {
                    $phone = preg_replace('/[^0-9]/', '', $msg['contact']['phone_number'] ?? '');
                    if (str_starts_with($phone, '98') && strlen($phone) === 12) {
                        $phone = '0' . substr($phone, 2);
                    } elseif (strlen($phone) === 10 && str_starts_with($phone, '9')) {
                        $phone = '0' . $phone;
                    }

                    echo "📱 شماره دریافت شد: {$phone} (چت‌آیدی: {$chatId})\n";

                    $confirmMsg = "✅ شماره موبایل شما (*{$phone}*) با موفقیت تایید و متصل شد. 🍦\n" .
                                  "از این پس صورت‌حساب‌ها، فاکتورهای فروش و جشنواره‌های تخفیف مستقیماً به این صفحه ارسال خواهند شد. ✨";

                    sendBaleMessage($chatId, $confirmMsg, ['remove_keyboard' => true]);
                    echo "🎉 پیام تاییدیه اتصال ارسال شد.\n";
                }
            }
        }
    }

    sleep(1);
}
