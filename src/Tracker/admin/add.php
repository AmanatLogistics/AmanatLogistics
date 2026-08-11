<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/includes/auth_check.php';

$defaultSteps = [
    1 => ['title' => 'Shipment Received', 'desc' => 'We have received your shipment at our origin office.'],
    2 => ['title' => 'Origin Warehouse', 'desc' => 'Your shipment is at our origin warehouse.'],
    3 => ['title' => 'Departed Origin', 'desc' => 'Your shipment has departed from origin.'],
    4 => ['title' => 'In Transit', 'desc' => 'Your shipment is in transit to destination.'],
    5 => ['title' => 'Customs Clearance', 'desc' => 'Your shipment is pending customs clearance.'],
    6 => ['title' => 'Destination Warehouse', 'desc' => 'Your shipment will arrive at destination warehouse.'],
    7 => ['title' => 'Out for Delivery', 'desc' => 'Your shipment is out for delivery.'],
    8 => ['title' => 'Delivered', 'desc' => 'Your shipment has been delivered.'],
];

$error = '';
$old = []; // used to repopulate the form if there's a validation error

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $old = $_POST;

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
        $chk = mysqli_prepare($conn, "SELECT id FROM shipments WHERE tracking_number = ?");
        mysqli_stmt_bind_param($chk, 's', $tracking_number);
        mysqli_stmt_execute($chk);
        if (mysqli_fetch_assoc(mysqli_stmt_get_result($chk))) {
            $error = 'A shipment with that tracking number already exists.';
        } else {
            $stmt = mysqli_prepare($conn, "INSERT INTO shipments
                (tracking_number, invoice_number, customer_name, origin, destination, total_packages, total_weight, shipping_method, booking_date, estimated_delivery, whatsapp_number, current_step)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
            mysqli_stmt_bind_param(
                $stmt, 'sssssisssssi',
                $tracking_number, $invoice_number, $customer_name, $origin, $destination,
                $total_packages, $total_weight, $shipping_method, $booking_date, $estimated_delivery,
                $whatsapp_number, $current_step
            );
            mysqli_stmt_execute($stmt);
            $shipmentId = mysqli_insert_id($conn);

            $stepStmt = mysqli_prepare($conn, "INSERT INTO shipment_steps
                (shipment_id, step_number, step_title, step_description, step_date, step_time) VALUES (?,?,?,?,?,?)");

            foreach ($defaultSteps as $num => $meta) {
                $stepDate = trim($_POST['step_date'][$num] ?? '');
                $stepTime = trim($_POST['step_time'][$num] ?? '');
                $stepDateParam = $stepDate !== '' ? $stepDate : null;
                $stepTimeParam = $stepTime !== '' ? $stepTime : null;
                $title = $meta['title'];
                $desc  = $meta['desc'];

                mysqli_stmt_bind_param($stepStmt, 'iissss', $shipmentId, $num, $title, $desc, $stepDateParam, $stepTimeParam);
                mysqli_stmt_execute($stepStmt);
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
<title>Add Shipment - Fast Cargo Admin</title>
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
        <h1>Add New Shipment</h1>
        <a href="dashboard.php" class="btn btn-cancel"><i class="fa-solid fa-arrow-left"></i> Back</a>
    </div>

    <div class="card">
        <?php if ($error): ?><div class="alert alert-error"><?= h($error) ?></div><?php endif; ?>

        <form method="post">
            <div class="section-title">Shipment Details</div>
            <div class="form-grid">
                <div class="form-group">
                    <label>Tracking Number *</label>
                    <input type="text" name="tracking_number" value="<?= h($old['tracking_number'] ?? '') ?>" required>
                </div>
                <div class="form-group">
                    <label>Invoice Number *</label>
                    <input type="text" name="invoice_number" value="<?= h($old['invoice_number'] ?? '') ?>" required>
                </div>
                <div class="form-group">
                    <label>Customer Name *</label>
                    <input type="text" name="customer_name" value="<?= h($old['customer_name'] ?? '') ?>" required>
                </div>
                <div class="form-group">
                    <label>WhatsApp Number (with country code)</label>
                    <input type="text" name="whatsapp_number" placeholder="e.g. 923001234567" value="<?= h($old['whatsapp_number'] ?? '') ?>">
                </div>
                <div class="form-group">
                    <label>Origin *</label>
                    <input type="text" name="origin" value="<?= h($old['origin'] ?? '') ?>" required>
                </div>
                <div class="form-group">
                    <label>Destination *</label>
                    <input type="text" name="destination" value="<?= h($old['destination'] ?? '') ?>" required>
                </div>
                <div class="form-group">
                    <label>Total Packages</label>
                    <input type="number" min="1" name="total_packages" value="<?= h($old['total_packages'] ?? 1) ?>">
                </div>
                <div class="form-group">
                    <label>Total Weight</label>
                    <input type="text" name="total_weight" placeholder="e.g. 120.5 KG" value="<?= h($old['total_weight'] ?? '') ?>">
                </div>
                <div class="form-group">
                    <label>Shipping Method</label>
                    <select name="shipping_method">
                        <?php foreach (['Sea Freight','Air Freight','Land Freight','Express'] as $m): ?>
                            <option value="<?= h($m) ?>" <?= (($old['shipping_method'] ?? '') === $m) ? 'selected' : '' ?>><?= h($m) ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="form-group">
                    <label>Current Status Step</label>
                    <select name="current_step">
                        <?php foreach ($defaultSteps as $num => $meta): ?>
                            <option value="<?= $num ?>" <?= (($old['current_step'] ?? 1) == $num) ? 'selected' : '' ?>><?= $num ?>. <?= h($meta['title']) ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="form-group">
                    <label>Booking Date *</label>
                    <input type="date" name="booking_date" value="<?= h($old['booking_date'] ?? '') ?>" required>
                </div>
                <div class="form-group">
                    <label>Estimated Delivery *</label>
                    <input type="date" name="estimated_delivery" value="<?= h($old['estimated_delivery'] ?? '') ?>" required>
                </div>
            </div>

            <div class="section-title">Progress Timeline (fill in date/time as each stage happens &mdash; leave blank if not reached yet)</div>
            <div class="steps-grid">
                <?php foreach ($defaultSteps as $num => $meta): ?>
                <div class="step-card">
                    <h4><?= $num ?>. <?= h($meta['title']) ?></h4>
                    <label>Date</label>
                    <input type="date" name="step_date[<?= $num ?>]" value="<?= h($old['step_date'][$num] ?? '') ?>">
                    <label>Time (e.g. 10:30 AM)</label>
                    <input type="text" name="step_time[<?= $num ?>]" value="<?= h($old['step_time'][$num] ?? '') ?>">
                </div>
                <?php endforeach; ?>
            </div>

            <div class="form-actions">
                <button type="submit" class="btn btn-add"><i class="fa-solid fa-check"></i> Save Shipment</button>
                <a href="dashboard.php" class="btn btn-cancel">Cancel</a>
            </div>
        </form>
    </div>
</div>

</body>
</html>
