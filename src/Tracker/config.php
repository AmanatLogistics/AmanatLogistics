<?php
/**
 * Fast Cargo - Database Configuration
 * Update these 4 values to match your hosting / XAMPP / MySQL setup.
 */
define('DB_HOST', 'localhost');
define('DB_NAME', 'tracking');
define('DB_USER', 'root');
define('DB_PASS', '');

// Site settings
define('SITE_NAME', 'Fast Cargo');
define('SITE_TAGLINE', 'Worldwide Logistics');

mysqli_report(MYSQLI_REPORT_OFF); // we handle errors manually below

$conn = mysqli_connect(DB_HOST, DB_USER, DB_PASS, DB_NAME);

if (!$conn) {
    die('Database connection failed. Please check config.php and make sure the "tracking" database has been imported (see database.sql). Error: ' . mysqli_connect_error());
}

mysqli_set_charset($conn, 'utf8mb4');

// Start session everywhere config.php is loaded (used by the admin panel)
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

/**
 * Small helper to escape output safely in HTML.
 */
function h($value) {
    return htmlspecialchars($value ?? '', ENT_QUOTES, 'UTF-8');
}
