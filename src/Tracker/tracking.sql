-- ============================================================
-- Fast Cargo - Shipment Tracking System
-- Database Schema
-- Import this file in phpMyAdmin (or `mysql -u root -p < database.sql`)
-- ============================================================

CREATE DATABASE IF NOT EXISTS tracking CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tracking;

-- ------------------------------------------------------------
-- Admin users (login for the admin panel)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- NOTE: No admin account is created here on purpose.
-- After importing this file, open admin/setup.php ONE TIME in your
-- browser to create your admin username/password (it uses PHP's
-- password_hash() so the hash is generated correctly for your server).
-- Delete admin/setup.php after you've created the account.

-- ------------------------------------------------------------
-- Shipments (main record shown in "Shipment Details")
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tracking_number VARCHAR(50) NOT NULL UNIQUE,
    invoice_number VARCHAR(50) NOT NULL,
    customer_name VARCHAR(150) NOT NULL,
    origin VARCHAR(150) NOT NULL,
    destination VARCHAR(150) NOT NULL,
    total_packages INT NOT NULL DEFAULT 1,
    total_weight VARCHAR(50) NOT NULL,
    shipping_method VARCHAR(50) NOT NULL,
    booking_date DATE NOT NULL,
    estimated_delivery DATE NOT NULL,
    whatsapp_number VARCHAR(30) DEFAULT NULL,
    current_step TINYINT NOT NULL DEFAULT 1, -- 1 to 8, controls progress bar
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- Shipment progress steps (the 8-step timeline)
-- Each shipment gets 8 rows (one per step) created automatically
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipment_steps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shipment_id INT NOT NULL,
    step_number TINYINT NOT NULL,
    step_title VARCHAR(100) NOT NULL,
    step_description VARCHAR(255) NOT NULL,
    step_date DATE DEFAULT NULL,
    step_time VARCHAR(20) DEFAULT NULL,
    FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
);

-- The 8 default step titles/descriptions used whenever a new shipment is created
-- (Handled in PHP on insert, listed here for reference)
-- 1. Shipment Received      - We have received your shipment at our origin office.
-- 2. Origin Warehouse       - Your shipment is at our origin warehouse.
-- 3. Departed Origin        - Your shipment has departed from origin.
-- 4. In Transit             - Your shipment is in transit to destination.
-- 5. Customs Clearance      - Your shipment is pending customs clearance.
-- 6. Destination Warehouse  - Your shipment will arrive at destination warehouse.
-- 7. Out for Delivery       - Your shipment is out for delivery.
-- 8. Delivered              - Your shipment has been delivered.

-- ------------------------------------------------------------
-- Sample shipment matching the screenshot you sent
-- ------------------------------------------------------------
INSERT INTO shipments
(tracking_number, invoice_number, customer_name, origin, destination, total_packages, total_weight, shipping_method, booking_date, estimated_delivery, whatsapp_number, current_step)
VALUES
('FC1234567890', 'INV-2024-00231', 'Ahmad Khan', 'Guangzhou, China', 'Kandahar, Afghanistan', 5, '120.5 KG', 'Sea Freight', '2024-05-12', '2024-06-25', '923001234567', 4)
ON DUPLICATE KEY UPDATE tracking_number = tracking_number;

SET @sid = (SELECT id FROM shipments WHERE tracking_number = 'FC1234567890');

INSERT INTO shipment_steps (shipment_id, step_number, step_title, step_description, step_date, step_time) VALUES
(@sid, 1, 'Shipment Received', 'We have received your shipment at our origin office.', '2024-05-12', '10:30 AM'),
(@sid, 2, 'Custon Clearnce', 'Your shipment Waiting For Shipment Clearence.', '2024-05-13', '02:15 PM'),
(@sid, 3, 'Departed Origin', 'Your shipment has departed from origin.', '2024-05-15', '09:45 AM'),
(@sid, 4, 'In Salang', 'Your shipment is Passing Salang Pass.', '2024-05-18', '11:20 AM'),
(@sid, 5, 'Hairatan Customs Clearance', 'Your shipment is pending Hairatan customs clearance.', NULL, NULL),
(@sid, 6, 'In Transit', 'Your shipment is In Transit To Tashkent.', NULL, NULL),
(@sid, 7, 'Tashkent Airport', 'Your shipment is In Tashkent Airport.', NULL, NULL),
(@sid, 8, 'Delivered', 'Your shipment has been delivered.', NULL, NULL);
