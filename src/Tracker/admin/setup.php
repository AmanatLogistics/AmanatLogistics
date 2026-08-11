<?php
require_once __DIR__ . '/../config.php';

// Safety: if an admin already exists, don't allow creating another one here.
$existing = mysqli_query($conn, "SELECT COUNT(*) as c FROM admins");
$existingCount = mysqli_fetch_assoc($existing)['c'];

$message = '';
$done = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $existingCount == 0) {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';

    if ($username === '' || strlen($password) < 6) {
        $message = 'Please enter a username and a password of at least 6 characters.';
    } else {
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = mysqli_prepare($conn, "INSERT INTO admins (username, password) VALUES (?, ?)");
        mysqli_stmt_bind_param($stmt, 'ss', $username, $hash);
        mysqli_stmt_execute($stmt);
        $done = true;
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Admin Setup - Fast Cargo</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="assets/css/admin.css">
</head>
<body class="login-body">
<div class="login-box">
    <h2>Create Admin Account</h2>

    <?php if ($existingCount > 0): ?>
        <p class="alert alert-error">An admin account already exists. For security, delete this file (admin/setup.php) now.</p>
        <a class="btn-primary" href="login.php" style="display:block; text-align:center;">Go to Login</a>
    <?php elseif ($done): ?>
        <p class="alert alert-success">Admin account created successfully!</p>
        <p style="font-size:13px;color:#667085;margin-bottom:16px;">For security, please delete <code>admin/setup.php</code> from your server now.</p>
        <a class="btn-primary" href="login.php" style="display:block; text-align:center;">Go to Login</a>
    <?php else: ?>
        <?php if ($message): ?><p class="alert alert-error"><?= h($message) ?></p><?php endif; ?>
        <form method="post">
            <label>Username</label>
            <input type="text" name="username" required>
            <label>Password</label>
            <input type="password" name="password" required minlength="6">
            <button class="btn-primary" type="submit">Create Account</button>
        </form>
    <?php endif; ?>
</div>
</body>
</html>
