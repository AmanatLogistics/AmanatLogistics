<?php require_once __DIR__ . '/config.php'; ?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Track Your Shipment - <?= h(SITE_NAME) ?></title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="assets/css/style.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
</head>
<body>

<header class="site-header">
    <div class="brand">
    <img src="assets/img/brand-logo.png"
         alt="Amanat Logistics"
         class="brand-image">

    
</div>
    </div>
    <nav class="main-nav ">
        <a href="index.php">Home</a>
        <a href="index.php" class="active text-[14.5px] transition-colors hover:text-plum-hover border-b-2 border-gold pb-0.5 font-semibold text-plum-hover">Track Shipment</a>
        <a href="#">Services</a>
        <a href="#">About Us</a>
        <a href="#">Contact</a>
    </nav>
</header>

<section class="hero">
    <h1>TRACK YOUR SHIPMENT</h1>
    <div class="breadcrumb"><a href="index.php">Home</a> / <span>Track Shipment</span></div>
</section>

<div class="container">
    <div class="card-title"><i class="fa-solid fa-location-dot icon" ></i> Track Your Shipment</div>

    <form class="search-row" method="get" action="index.php">
        <input type="text" name="code" placeholder="Enter Tracking Number or Invoice Number"
               value="<?= h($_GET['code'] ?? '') ?>" required>
        <button type="submit"><i class="fa-solid fa-magnifying-glass"></i> Track Now</button>
    </form>

    <?php
    $shipment = null;
    $steps = [];
    $searched = isset($_GET['code']) && trim($_GET['code']) !== '';

    if ($searched) {
        $code = trim($_GET['code']);
        $stmt = mysqli_prepare($conn, "SELECT * FROM shipments WHERE tracking_number = ? OR invoice_number = ? LIMIT 1");
        mysqli_stmt_bind_param($stmt, 'ss', $code, $code);
        mysqli_stmt_execute($stmt);
        $result = mysqli_stmt_get_result($stmt);
        $shipment = mysqli_fetch_assoc($result);

        if ($shipment) {
            $stmt2 = mysqli_prepare($conn, "SELECT * FROM shipment_steps WHERE shipment_id = ? ORDER BY step_number ASC");
            mysqli_stmt_bind_param($stmt2, 'i', $shipment['id']);
            mysqli_stmt_execute($stmt2);
            $res2 = mysqli_stmt_get_result($stmt2);
            while ($row = mysqli_fetch_assoc($res2)) {
                $steps[] = $row;
            }
        }
    }
    ?>

    <?php if ($searched && !$shipment): ?>
        <div class="alert alert-error">
            <i class="fa-solid fa-circle-exclamation"></i>
            No shipment found for "<?= h($code) ?>". Please check the tracking or invoice number and try again.
        </div>
    <?php endif; ?>

    <?php if ($shipment): ?>
        <?php
        $currentStep = (int) $shipment['current_step'];
        $statusLabel = 'Pending';
        foreach ($steps as $s) {
            if ((int) $s['step_number'] === $currentStep) { $statusLabel = $s['step_title']; }
        }
        ?>
        <div class="tracking-grid">
            <!-- Shipment Details -->
            <div class="panel">
                <div class="card-title" style="font-size:16px;"><i class="fa-solid fa-file-lines icon"></i> Shipment Details</div>

                <div class="detail-row"><span class="label">Tracking Number</span><span class="value"><?= h($shipment['tracking_number']) ?></span></div>
                <div class="detail-row"><span class="label">Invoice Number</span><span class="value"><?= h($shipment['invoice_number']) ?></span></div>
                <div class="detail-row"><span class="label">Customer Name</span><span class="value"><?= h($shipment['customer_name']) ?></span></div>
                <div class="detail-row"><span class="label">Origin</span><span class="value"><?= h($shipment['origin']) ?></span></div>
                <div class="detail-row"><span class="label">Destination</span><span class="value"><?= h($shipment['destination']) ?></span></div>
                <div class="detail-row"><span class="label">Total Packages</span><span class="value"><?= h($shipment['total_packages']) ?></span></div>
                <div class="detail-row"><span class="label">Total Weight</span><span class="value"><?= h($shipment['total_weight']) ?></span></div>
                <div class="detail-row"><span class="label">Shipping Method</span><span class="value"><?= h($shipment['shipping_method']) ?></span></div>
                <div class="detail-row"><span class="label">Booking Date</span><span class="value"><?= h(date('Y-m-d', strtotime($shipment['booking_date']))) ?></span></div>
                <div class="detail-row"><span class="label">Estimated Delivery</span><span class="value"><?= h(date('Y-m-d', strtotime($shipment['estimated_delivery']))) ?></span></div>

                <?php if (!empty($shipment['whatsapp_number'])): ?>
                <a class="whatsapp-btn" target="_blank"
                   href="https://wa.me/<?= h(preg_replace('/\D/', '', $shipment[+93700098848])) ?>">
                    <i class="fa-brands fa-whatsapp"></i> Chat on WhatsApp
                </a>
                <?php endif; ?>
            </div>

            <!-- Progress -->
            <div class="panel">
                <div class="progress-header">
                    <div class="card-title" style="font-size:16px; margin:0;"><i class="fa-solid fa-truck-fast icon"></i> Shipment Progress</div>
                    <div><span class="status-label">Current Status: </span><span class="status-value"><?= h($statusLabel) ?></span></div>
                </div>

                <ul class="timeline">
                    <?php foreach ($steps as $s):
                        $num = (int) $s['step_number'];
                        if ($num < $currentStep) { $state = 'completed'; $icon = 'fa-check'; }
                        elseif ($num === $currentStep) { $state = 'active'; $icon = 'fa-truck'; }
                        else { $state = 'pending'; $icon = 'fa-clock'; }
                    ?>
                    <li class="<?= $state ?>">
                        <div class="step-icon"><i class="fa-solid <?= $icon ?>"></i></div>
                        <div class="step-title"><?= $num ?>. <?= h($s['step_title']) ?></div>
                        <div class="step-time">
                            <?php if ($s['step_date']): ?>
                                <?= h(date('Y-m-d', strtotime($s['step_date']))) ?><?= $s['step_time'] ? ' ' . h($s['step_time']) : '' ?>
                            <?php else: ?>
                                Pending
                            <?php endif; ?>
                        </div>
                        <div class="step-desc"><?= h($s['step_description']) ?></div>
                    </li>
                    <?php endforeach; ?>
                </ul>
            </div>
        </div>
    <?php elseif (!$searched): ?>
        <div class="empty-state">
            <div class="big-icon"><i class="fa-solid fa-box-open"></i></div>
            Enter your tracking or invoice number above to see your shipment status.
        </div>
    <?php endif; ?>
</div>

<footer class="site-footer">
    &copy; <?= date('Y') ?> Fast Cargo. All Rights Reserved.
</footer>

</body>
</html>
