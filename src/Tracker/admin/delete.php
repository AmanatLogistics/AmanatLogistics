<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/includes/auth_check.php';

$id = (int) ($_GET['id'] ?? 0);

if ($id > 0) {
    // shipment_steps rows are removed automatically via ON DELETE CASCADE
    $stmt = mysqli_prepare($conn, "DELETE FROM shipments WHERE id = ?");
    mysqli_stmt_bind_param($stmt, 'i', $id);
    mysqli_stmt_execute($stmt);
}

header('Location: dashboard.php?deleted=1');
exit;
