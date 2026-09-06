<?php
// auth_helper.php

// آدرس سرور بک‌اند NestJS
define('API_BASE_URL', 'http://localhost:3000/api/');

function startSecureSession()
{
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
}

function isLoggedIn()
{
    startSecureSession();
    return isset($_SESSION['accessToken']) && !empty($_SESSION['accessToken']);
}

function requireLogin()
{
    if (!isLoggedIn()) {
        // لاگین خودکار با کاربر ویزیتور پیش‌فرض در صورت نبود سشن
        $ch = curl_init(API_BASE_URL . "auth/login");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Content-Type: application/json",
            "Accept: application/json"
        ]);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
            "phone" => "09121234567",
            "password" => "123456"
        ]));

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode >= 200 && $httpCode < 300 && $response) {
            $data = json_decode($response, true);
            if (!empty($data['accessToken'])) {
                $_SESSION['accessToken'] = $data['accessToken'];
                $_SESSION['user'] = $data['user'] ?? ['firstName' => 'علی', 'lastName' => 'حسینی', 'role' => 'VISITOR'];
                return;
            }
        }

        header("Location: index.php");
        exit();
    }
}

function getUserData()
{
    startSecureSession();
    return $_SESSION['user'] ?? null;
}

function getAccessToken()
{
    startSecureSession();
    return $_SESSION['accessToken'] ?? '';
}

/**
 * تابع ارسال درخواست به API سرور NestJS با توکن احراز هویت
 */
function apiCall($endpoint, $method = 'GET', $data = null)
{
    $token = getAccessToken();
    $url = API_BASE_URL . ltrim($endpoint, '/');

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);

    $headers = [
        "Content-Type: application/json",
        "Accept: application/json"
    ];

    if (!empty($token)) {
        $headers[] = "Authorization: Bearer " . $token;
    }

    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($data !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }
    } elseif ($method === 'PUT') {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PUT');
        if ($data !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }
    } elseif ($method === 'DELETE') {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'DELETE');
    }

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response !== false && $httpCode >= 200 && $httpCode < 300) {
        return json_decode($response, true);
    }

    return null;
}

/**
 * تابع تبدیل اعداد انگلیسی به فارسی
 */
function toPersianNum($number)
{
    $persian = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    $english = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    return str_replace($english, $persian, (string)$number);
}

/**
 * فرمت‌بندی مبالغ بزرگ به میلیون یا هزار تومان
 */
function formatToman($amount)
{
    $val = (float)$amount;
    if ($val >= 1000000) {
        $inMillion = round($val / 1000000, 1);
        return [
            'value' => toPersianNum($inMillion),
            'suffix' => 'میلیون'
        ];
    } elseif ($val >= 1000) {
        $inThousand = round($val / 1000, 0);
        return [
            'value' => toPersianNum($inThousand),
            'suffix' => 'هزار'
        ];
    }

    return [
        'value' => toPersianNum($val),
        'suffix' => 'تومان'
    ];
}

function logout()
{
    startSecureSession();

    // پاک کردن تمام متغیرهای سشن
    $_SESSION = array();

    // اگر از کوکی سشن استفاده می‌شود، آن را حذف کن
    if (ini_get("session.use_cookies")) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params["path"],
            $params["domain"],
            $params["secure"],
            $params["httponly"]
        );
    }

    // نابودی سشن
    session_destroy();
}
