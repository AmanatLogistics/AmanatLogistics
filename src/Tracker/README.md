# Fast Cargo — Shipment Tracking System (PHP + MySQL)

A tracking page that matches the design you sent, plus an admin panel where you
manually add/edit/delete shipments and their 8-step progress timeline.

## What's included
```
fastcargo-tracking/
├── index.php              ← public tracking page (customers use this)
├── config.php              ← database connection settings (edit this first)
├── database.sql            ← import this to create the database
├── assets/css/style.css    ← public page styling
└── admin/
    ├── setup.php            ← run ONCE to create your admin login, then delete it
    ├── login.php
    ├── logout.php
    ├── dashboard.php        ← list / search / delete shipments
    ├── add.php              ← add a new shipment + fill in its 8 timeline steps
    ├── edit.php             ← edit a shipment + update timeline dates
    ├── includes/auth_check.php
    └── assets/css/admin.css
```

## 1. Install (local — XAMPP / WAMP / Laragon)
1. Copy the `fastcargo-tracking` folder into your server's web root
   (e.g. `htdocs/` for XAMPP).
2. Open **phpMyAdmin**, click **Import**, and select `database.sql`.
   This creates the `fastcargo_tracking` database with all tables and one
   sample shipment (the one from your screenshot, tracking # `FC1234567890`).
3. Open `config.php` and check the DB settings match your setup:
   ```php
   define('DB_HOST', 'localhost');
   define('DB_NAME', 'fastcargo_tracking');
   define('DB_USER', 'root');
   define('DB_PASS', '');
   ```
   (Default XAMPP/WAMP values are usually fine as-is.)
4. Visit `http://localhost/fastcargo-tracking/admin/setup.php` in your
   browser and create your admin username/password.
5. **Delete `admin/setup.php`** right after — it's only meant to run once.
6. Log in at `http://localhost/fastcargo-tracking/admin/login.php`.

## 2. Install (shared hosting / cPanel)
Same steps as above:
1. Upload the folder via FTP or File Manager.
2. Create a MySQL database + user in cPanel, then import `database.sql`
   into it via phpMyAdmin (or update the `database.sql` header if your host
   doesn't allow `CREATE DATABASE`).
3. Update `config.php` with the DB name/user/password your host gave you.
4. Visit `yourdomain.com/admin/setup.php`, create your login, then delete
   that file.

## 3. Using it
- **Customers:** go to `index.php`, type a tracking number or invoice number
  (try `FC1234567890` or `INV-2024-00231` with the sample data), click
  **Track Now**.
- **You (admin):** go to `admin/login.php` →
  - **Add New Shipment** — fill in the shipment details, pick the *current
    status step*, and optionally fill in a date/time for each of the 8
    timeline stages (leave future stages blank — they'll show as "Pending").
  - **Edit** any shipment from the dashboard table to update its status or
    timeline dates as it moves along.
  - **Delete** removes the shipment and its timeline permanently.

## Notes
- Passwords are stored properly hashed (PHP `password_hash`/`password_verify`) —
  never in plain text.
- All database queries use prepared statements, so it's protected against
  SQL injection.
- The "Chat on WhatsApp" button uses the WhatsApp number you enter per
  shipment (with country code, digits only, e.g. `923001234567`). Leave it
  blank to hide the button for that shipment.
- The 8 timeline step names/descriptions match your screenshot exactly. If
  you want different step names, edit the `$defaultSteps` array near the top
  of `admin/add.php`.






