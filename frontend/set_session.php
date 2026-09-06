<?php
// set_session.php — تنظیم سشن کاربر پس از تایید کد بله
require_once 'auth_helper.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);

    $token = $data['accessToken'] ?? '';
    $user = $data['user'] ?? null;

    if (!empty($token)) {
        startSecureSession();
        session_regenerate_id(true);
        $_SESSION['accessToken'] = $token;
        if ($user) {
            $_SESSION['user'] = $user;
        }
        echo json_encode(['success' => true]);
        exit();
    }
}

echo json_encode(['success' => false, 'message' => 'توکن نامعتبر است']);
