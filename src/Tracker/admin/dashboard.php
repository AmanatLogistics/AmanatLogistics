<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/includes/auth_check.php';

$search = trim($_GET['q'] ?? '');
if ($search !== '') {
    $like = '%' . $search . '%';
    $stmt = mysqli_prepare($conn, "SELECT * FROM shipments WHERE tracking_number LIKE ? OR invoice_number LIKE ? OR customer_name LIKE ? ORDER BY created_at DESC");
    mysqli_stmt_bind_param($stmt, 'sss', $like, $like, $like);
    mysqli_stmt_execute($stmt);
    $result = mysqli_stmt_get_result($stmt);
} else {
    $result = mysqli_query($conn, "SELECT * FROM shipments ORDER BY created_at DESC");
}

$stepTitles = [1=>'Shipment Received',2=>'Origin Warehouse',3=>'Departed Origin',4=>'In Transit',5=>'Customs Clearance',6=>'Destination Warehouse',7=>'Out for Delivery',8=>'Delivered'];
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Dashboard - Fast Cargo Admin</title>
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
        <h1>Shipments</h1>
        <a href="add.php" class="btn btn-add"><i class="fa-solid fa-plus"></i> Add New Shipment</a>
    </div>

    <?php if (isset($_GET['deleted'])): ?>
        <div class="alert alert-success">Shipment deleted successfully.</div>
    <?php elseif (isset($_GET['saved'])): ?>
        <div class="alert alert-success">Shipment saved successfully.</div>
    <?php endif; ?>

    <div class="card">
        <form method="get" style="margin-bottom:18px;">
            <input type="text" name="q" placeholder="Search by tracking #, invoice #, or customer name"
                   value="<?= h($search) ?>"
                   style="width:100%;max-width:400px;padding:10px 14px;border:1px solid #e4e7ec;border-radius:6px;font-size:14px;">
        </form>

        <table>
            <thead>
                <tr>
                    <th>Tracking #</th>
                    <th>Customer</th>
                    <th>Route</th>
                    <th>Status</th>
                    <th>Est. Delivery</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                <?php if (mysqli_num_rows($result) === 0): ?>
                    <tr><td colspan="6" style="text-align:center;color:#667085;padding:30px;">No shipments found.</td></tr>
                <?php endif; ?>
                <?php while ($row = mysqli_fetch_assoc($result)): ?>
                    <tr>
                        <td><strong><?= h($row['tracking_number']) ?></strong><br><span style="color:#98a2b3;font-size:12.5px;"><?= h($row['invoice_number']) ?></span></td>
                        <td><?= h($row['customer_name']) ?></td>
                        <td><?= h($row['origin']) ?> &rarr; <?= h($row['destination']) ?></td>
                        <td>
                            <?php $step = (int)$row['current_step']; ?>
                            <?php if ($step >= 8): ?>
                                <span class="badge badge-delivered">Delivered</span>
                            <?php elseif ($step >= 1): ?>
                                <span class="badge badge-transit"><?= h($stepTitles[$step] ?? 'In Progress') ?></span>
                            <?php else: ?>
                                <span class="badge badge-pending">Pending</span>
                            <?php endif; ?>
                        </td>
                        <td><?= h(date('Y-m-d', strtotime($row['estimated_delivery']))) ?></td>
                        <td class="actions-cell">
                            <a class="btn btn-edit" href="edit.php?id=<?= (int)$row['id'] ?>"><i class="fa-solid fa-pen"></i> Edit</a>
                            <a class="btn btn-delete" href="delete.php?id=<?= (int)$row['id'] ?>"
                               onclick="return confirm('Delete shipment <?= h($row['tracking_number']) ?>? This cannot be undone.');">
                               <i class="fa-solid fa-trash"></i> Delete</a>
                        </td>
                    </tr>
                <?php endwhile; ?>
            </tbody>
        </table>
    </div>
</div>

</body>
</html>
