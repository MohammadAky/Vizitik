<?php
require_once 'auth_helper.php';

logout();

// ریدارکت به صفحه لاگین
header("Location: index.php");
exit();
