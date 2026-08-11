<?php
// Include config.php BEFORE this file so $conn and the session are ready.
if (empty($_SESSION['admin_id'])) {
    header('Location: login.php');
    exit;
}
