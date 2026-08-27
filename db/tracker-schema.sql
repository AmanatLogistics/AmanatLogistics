-- ============================================================
-- Amanat Logistics — Shipment Tracker
-- Postgres schema (ported from the original MySQL src/Tracker/tracking.sql)
--
-- You normally do NOT need to run this: the app creates these tables itself on
-- first use (see ensureSchema() in src/lib/tracker/db.ts). It is kept here as
-- documentation, and for anyone who prefers to create the tables by hand —
-- paste it into the Neon SQL Editor.
--
-- Stages carry a date only. An earlier version also stored a free-text time of
-- day per stage; it was dropped as noise. A `step_time` column left over from
-- that in an existing database is simply ignored.
--
-- The original `admins` table is intentionally gone: the admin panel now
-- authenticates against the TRACKER_ADMIN_PASSWORD environment variable, so
-- there are no password hashes to store and no public setup page to delete.
-- ============================================================

CREATE TABLE IF NOT EXISTS shipments (
    id                 SERIAL PRIMARY KEY,
    tracking_number    TEXT NOT NULL UNIQUE,
    invoice_number     TEXT NOT NULL,
    customer_name      TEXT NOT NULL,
    origin             TEXT NOT NULL DEFAULT '',
    destination        TEXT NOT NULL DEFAULT '',
    total_packages     INTEGER NOT NULL DEFAULT 1,
    total_weight       TEXT NOT NULL DEFAULT '',
    shipping_method    TEXT NOT NULL DEFAULT 'Sea Freight',
    booking_date       DATE NOT NULL,
    estimated_delivery DATE NOT NULL,
    actual_delivery    DATE,          -- when it really arrived; NULL until then
    whatsapp_number    TEXT,
    current_step       SMALLINT NOT NULL DEFAULT 1,  -- 1..8, drives the timeline
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The 8-step progress timeline. Each shipment gets 8 rows, written together
-- with the shipment itself. Titles and descriptions are per-shipment, so
-- route-specific stages ("In Salang", "Hairatan Customs Clearance") are
-- possible — in the PHP version they were hardcoded and uneditable.
CREATE TABLE IF NOT EXISTS shipment_steps (
    id               SERIAL PRIMARY KEY,
    shipment_id      INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    step_number      SMALLINT NOT NULL,
    step_title       TEXT NOT NULL,
    step_description TEXT NOT NULL DEFAULT '',
    step_date        DATE,          -- NULL until the stage is reached ("Pending")
    UNIQUE (shipment_id, step_number)
);

-- Customers may search by invoice number; tracking_number is already indexed
-- by its UNIQUE constraint.
CREATE INDEX IF NOT EXISTS shipments_invoice_idx ON shipments (invoice_number);
