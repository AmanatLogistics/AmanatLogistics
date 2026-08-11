<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/includes/auth_check.php';

$id = (int) ($_GET['id'] ?? 0);

$stmt = mysqli_prepare($conn, "SELECT * FROM shipments WHERE id = ?");
mysqli_stmt_bind_param($stmt, 'i', $id);
mysqli_stmt_execute($stmt);
$shipment = mysqli_fetch_assoc(mysqli_stmt_get_result($stmt));

if (!$shipment) {
    header('Location: dashboard.php');
    exit;
}

$stepStmt = mysqli_prepare($conn, "SELECT * FROM shipment_steps WHERE shipment_id = ? ORDER BY step_number ASC");
mysqli_stmt_bind_param($stepStmt, 'i', $id);
mysqli_stmt_execute($stepStmt);
$stepRes = mysqli_stmt_get_result($stepStmt);
$steps = [];
while ($row = mysqli_fetch_assoc($stepRes)) {
    $steps[(int) $row['step_number']] = $row;
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $tracking_number    = trim($_POST['tracking_number'] ?? '');
    $invoice_number     = trim($_POST['invoice_number'] ?? '');
    $customer_name      = trim($_POST['customer_name'] ?? '');
    $origin              = trim($_POST['origin'] ?? '');
    $destination         = trim($_POST['destination'] ?? '');
    $total_packages      = (int) ($_POST['total_packages'] ?? 0);
    $total_weight        = trim($_POST['total_weight'] ?? '');
    $shipping_method     = trim($_POST['shipping_method'] ?? '');
    $booking_date        = $_POST['booking_date'] ?? '';
    $estimated_delivery  = $_POST['estimated_delivery'] ?? '';
    $whatsapp_number     = trim($_POST['whatsapp_number'] ?? '');
    $current_step        = (int) ($_POST['current_step'] ?? 1);

    if ($tracking_number === '' || $invoice_number === '' || $customer_name === '' || $booking_date === '' || $estimated_delivery === '') {
        $error = 'Please fill in all required fields (marked *).';
    } else {
        $dupChk = mysqli_prepare($conn, "SELECT id FROM shipments WHERE tracking_number = ? AND id != ?");
        mysqli_stmt_bind_param($dupChk, 'si', $tracking_number, $id);
        mysqli_stmt_execute($dupChk);
        if (mysqli_fetch_assoc(mysqli_stmt_get_result($dupChk))) {
            $error = 'Another shipment already uses that tracking number.';
        } else {
            $upd = mysqli_prepare($conn, "UPDATE shipments SET
                tracking_number=?, invoice_number=?, customer_name=?, origin=?, destination=?,
                total_packages=?, total_weight=?, shipping_method=?, booking_date=?, estimated_delivery=?,
                whatsapp_number=?, current_step=? WHERE id=?");
            mysqli_stmt_bind_param(
                $upd, 'sssssisssssii',
                $tracking_number, $invoice_number, $customer_name, $origin, $destination,
                $total_packages, $total_weight, $shipping_method, $booking_date, $estimated_delivery,
                $whatsapp_number, $current_step, $id
            );
            mysqli_stmt_execute($upd);

            $stepUpd = mysqli_prepare($conn, "UPDATE shipment_steps SET step_date=?, step_time=? WHERE shipment_id=? AND step_number=?");
            for ($num = 1; $num <= 8; $num++) {
                $stepDate = trim($_POST['step_date'][$num] ?? '');
                $stepTime = trim($_POST['step_time'][$num] ?? '');
                $stepDateParam = $stepDate !== '' ? $stepDate : null;
                $stepTimeParam = $stepTime !== '' ? $stepTime : null;
                mysqli_stmt_bind_param($stepUpd, 'ssii', $stepDateParam, $stepTimeParam, $id, $num);
                mysqli_stmt_execute($stepUpd);
            }

            header('Location: dashboard.php?saved=1');
            exit;
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Edit Shipment - Fast Cargo Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="assets/css/admin.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
</head>
<body>

<header class="admin-header">
    <div class="brand">FAST <span>CARGO</span> Admin</div>
    <div class="user-info">
        <span><i class="fa-solid fa-user"></i> <?= h($_SESSION['admin_username']) ?></span>
        <a href="../index.php" target="_blank">View Site</a>
        <a class="logout-link" href="logout.php">Logout</a>
    </div>
</header>

<div class="admin-wrap">
    <div class="page-title-row">
        <h1>Edit Shipment &mdash; <?= h($shipment['tracking_number']) ?></h1>
        <a href="dashboard.php" class="btn btn-cancel"><i class="fa-solid fa-arrow-left"></i> Back</a>
    </div>

    <div class="card">
        <?php if ($error): ?><div class="alert alert-error"><?= h($error) ?></div><?php endif; ?>

        <form method="post">
            <div class="section-title">Shipment Details</div>
            <div class="form-grid">
                <div class="form-group">
                    <label>Tracking Number *</label>
                    <input type="text" name="tracking_number" value="<?= h($_POST['tracking_number'] ?? $shipment['tracking_number']) ?>" required>
                </div>
                <div class="form-group">
                    <label>Invoice Number *</label>
                    <input type="text" name="invoice_number" value="<?= h($_POST['invoice_number'] ?? $shipment['invoice_number']) ?>" required>
                </div>
                <div class="form-group">
                    <label>Customer Name *</label>
                    <input type="text" name="customer_name" value="<?= h($_POST['customer_name'] ?? $shipment['customer_name']) ?>" required>
                </div>
                <div class="form-group">
                    <label>WhatsApp Number (with country code)</label>
                    <input type="text" name="whatsapp_number" value="<?= h($_POST['whatsapp_number'] ?? $shipment['whatsapp_number']) ?>">
                </div>
                <div class="form-group">
                    <label>Origin *</label>
                    <input type="text" name="origin" value="<?= h($_POST['origin'] ?? $shipment['origin']) ?>" required>
                </div>
                <div class="form-group">
                    <label>Destination *</label>
                    <input type="text" name="destination" value="<?= h($_POST['destination'] ?? $shipment['destination']) ?>" required>
                </div>
                <div class="form-group">
                    <label>Total Packages</label>
                    <input type="number" min="1" name="total_packages" value="<?= h($_POST['total_packages'] ?? $shipment['total_packages']) ?>">
                </div>
                <div class="form-group">
                    <label>Total Weight</label>
                    <input type="text" name="total_weight" value="<?= h($_POST['total_weight'] ?? $shipment['total_weight']) ?>">
                </div>
                <div class="form-group">
                    <label>Shipping Method</label>
                    <select name="shipping_method">
                        <?php $curMethod = $_POST['shipping_method'] ?? $shipment['shipping_method']; ?>
                        <?php foreach (['Sea Freight','Air Freight','Land Freight','Express'] as $m): ?>
                            <option value="<?= h($m) ?>" <?= ($curMethod === $m) ? 'selected' : '' ?>><?= h($m) ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="form-group">
                    <label>Current Status Step</label>
                    <select name="current_step">
                        <?php $curStep = (int) ($_POST['current_step'] ?? $shipment['current_step']); ?>
                        <?php foreach ($steps as $num => $s): ?>
                            <option value="<?= $num ?>" <?= ($curStep === $num) ? 'selected' : '' ?>><?= $num ?>. <?= h($s['step_title']) ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="form-group">
                    <label>Booking Date *</label>
                    <input type="date" name="booking_date" value="<?= h($_POST['booking_date'] ?? $shipment['booking_date']) ?>" required>
                </div>
                <div class="form-group">
                    <label>Estimated Delivery *</label>
                    <input type="date" name="estimated_delivery" value="<?= h($_POST['estimated_delivery'] ?? $shipment['estimated_delivery']) ?>" required>
                </div>
            </div>

            <div class="section-title">Progress Timeline</div>
            <div class="steps-grid">
                <?php foreach ($steps as $num => $s): ?>
                <div class="step-card">
                    <h4><?= $num ?>. <?= h($s['step_title']) ?></h4>
                    <label>Date</label>
                    <input type="date" name="step_date[<?= $num ?>]" value="<?= h($s['step_date']) ?>">
                    <label>Time (e.g. 10:30 AM)</label>
                    <input type="text" name="step_time[<?= $num ?>]" value="<?= h($s['step_time']) ?>">
                </div>
                <?php endforeach; ?>
            </div>

            <div class="form-actions">
                <button type="submit" class="btn btn-add"><i class="fa-solid fa-check"></i> Update Shipment</button>
                <a href="dashboard.php" class="btn btn-cancel">Cancel</a>
            </div>
        </form>
    </div>
</div>

</body>
</html>
