/**
 * Amanat Office — database schema, as numbered migrations.
 *
 * NEVER edit a migration that may already have run on the live database: add
 * a new one at the end. ensureSchema() (db.ts) applies whatever is missing.
 *
 * Money convention (everywhere): every amount is stored three ways —
 *   amount    the figure as written, in `currency`
 *   per_usd   how many units of that currency make one US dollar on the day
 *             (USD 1, AFN ~70, AED 3.6725, CNY ~7.2, UZS ~12,700)
 *   usd       amount / per_usd, rounded to cents — what every report adds up
 * so a client billed in dollars who pays in afghanis, or a Tashkent agent paid
 * in som, all land in one consistent dollar ledger.
 */
export const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
CREATE TABLE office_users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  pw_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE office_settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE office_currencies (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  per_usd    NUMERIC(18,6) NOT NULL CHECK (per_usd > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO office_currencies (code, name, per_usd) VALUES
  ('USD', 'US dollar', 1),
  ('AFN', 'Afghan afghani', 70),
  ('AED', 'UAE dirham', 3.6725),
  ('CNY', 'Chinese yuan', 7.2),
  ('UZS', 'Uzbek som', 12700),
  ('PKR', 'Pakistani rupee', 280);

CREATE TABLE office_counters (
  key   TEXT PRIMARY KEY,
  value INT NOT NULL
);

-- Everyone money moves to or from: clients, agents, truck owners, airlines,
-- sarafs, suppliers. One table, so one statement shows both directions.
CREATE TABLE office_parties (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('client','agent','carrier','airline','sarafi','supplier','staff','other')),
  phone      TEXT,
  city       TEXT,
  country    TEXT,
  notes      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INT REFERENCES office_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX office_parties_kind ON office_parties (kind);

-- Where money sits: cash boxes, bank accounts, sarafs holding money for us.
-- Each account has ONE currency; payments into or out of it use that currency.
CREATE TABLE office_accounts (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('cash','bank','sarafi','hawala','other')),
  currency        TEXT NOT NULL REFERENCES office_currencies(code),
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  opening_date    DATE,
  notes           TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE office_shipments (
  id            SERIAL PRIMARY KEY,
  ref           TEXT NOT NULL UNIQUE,
  service       TEXT NOT NULL CHECK (service IN ('ups','china','tashkent','kabul_air','other')),
  client_id     INT REFERENCES office_parties(id) ON DELETE RESTRICT,
  ship_date     DATE NOT NULL,
  origin        TEXT,
  destination   TEXT,
  goods         TEXT,
  pieces        INT,
  weight_kg     NUMERIC(12,2),
  chargeable_kg NUMERIC(12,2),
  cbm           NUMERIC(12,3),
  awb_no        TEXT,
  tracking_no   TEXT,
  status        TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','in_transit','arrived','delivered','cancelled')),
  notes         TEXT,
  created_by    INT REFERENCES office_users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX office_shipments_client ON office_shipments (client_id);
CREATE INDEX office_shipments_date ON office_shipments (ship_date);
CREATE INDEX office_shipments_service ON office_shipments (service);

-- What the client is billed for a shipment (revenue).
CREATE TABLE office_charges (
  id          SERIAL PRIMARY KEY,
  shipment_id INT NOT NULL REFERENCES office_shipments(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty         NUMERIC(14,3),
  unit        TEXT,
  rate        NUMERIC(14,4),
  amount      NUMERIC(14,2) NOT NULL,
  currency    TEXT NOT NULL REFERENCES office_currencies(code),
  per_usd     NUMERIC(18,6) NOT NULL CHECK (per_usd > 0),
  usd         NUMERIC(14,2) NOT NULL,
  sort        INT NOT NULL DEFAULT 0
);
CREATE INDEX office_charges_shipment ON office_charges (shipment_id);

-- What a shipment costs us, and who we owe it to (truck owner, document agent,
-- Tashkent agent, airline, Kabul agent, China agent…).
CREATE TABLE office_costs (
  id          SERIAL PRIMARY KEY,
  shipment_id INT NOT NULL REFERENCES office_shipments(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  payee_id    INT REFERENCES office_parties(id) ON DELETE RESTRICT,
  description TEXT,
  qty         NUMERIC(14,3),
  rate        NUMERIC(14,4),
  amount      NUMERIC(14,2) NOT NULL,
  currency    TEXT NOT NULL REFERENCES office_currencies(code),
  per_usd     NUMERIC(18,6) NOT NULL CHECK (per_usd > 0),
  usd         NUMERIC(14,2) NOT NULL,
  sort        INT NOT NULL DEFAULT 0
);
CREATE INDEX office_costs_shipment ON office_costs (shipment_id);
CREATE INDEX office_costs_payee ON office_costs (payee_id);

-- One invoice per shipment. Its lines are the shipment's charges, so an
-- invoice can never disagree with the shipment it bills.
CREATE TABLE office_invoices (
  id          SERIAL PRIMARY KEY,
  number      TEXT NOT NULL UNIQUE,
  shipment_id INT NOT NULL UNIQUE REFERENCES office_shipments(id) ON DELETE CASCADE,
  issue_date  DATE NOT NULL,
  due_date    DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Money received (direction 'in', usually from a client) or paid
-- (direction 'out', usually to an agent, carrier or airline).
CREATE TABLE office_payments (
  id          SERIAL PRIMARY KEY,
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  pay_date    DATE NOT NULL,
  party_id    INT NOT NULL REFERENCES office_parties(id) ON DELETE RESTRICT,
  account_id  INT NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
  shipment_id INT REFERENCES office_shipments(id) ON DELETE SET NULL,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency    TEXT NOT NULL REFERENCES office_currencies(code),
  per_usd     NUMERIC(18,6) NOT NULL CHECK (per_usd > 0),
  usd         NUMERIC(14,2) NOT NULL,
  method      TEXT NOT NULL CHECK (method IN ('cash','hawala','bank','sarafi','other')),
  reference   TEXT,
  notes       TEXT,
  created_by  INT REFERENCES office_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX office_payments_party ON office_payments (party_id);
CREATE INDEX office_payments_account ON office_payments (account_id);
CREATE INDEX office_payments_shipment ON office_payments (shipment_id);
CREATE INDEX office_payments_date ON office_payments (pay_date);

-- Office running costs: rent, salaries, internet… paid straight away.
CREATE TABLE office_expenses (
  id          SERIAL PRIMARY KEY,
  exp_date    DATE NOT NULL,
  category    TEXT NOT NULL,
  description TEXT,
  payee_id    INT REFERENCES office_parties(id) ON DELETE SET NULL,
  account_id  INT NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency    TEXT NOT NULL REFERENCES office_currencies(code),
  per_usd     NUMERIC(18,6) NOT NULL CHECK (per_usd > 0),
  usd         NUMERIC(14,2) NOT NULL,
  method      TEXT NOT NULL CHECK (method IN ('cash','hawala','bank','sarafi','other')),
  reference   TEXT,
  created_by  INT REFERENCES office_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX office_expenses_date ON office_expenses (exp_date);

-- Moving money between our own accounts (e.g. hawala from the Tashkent saraf
-- to the Kandahar cash box). What arrives can be less than what left — that
-- difference, in dollars, is the transfer fee and counts as a cost.
CREATE TABLE office_transfers (
  id           SERIAL PRIMARY KEY,
  tr_date      DATE NOT NULL,
  from_account INT NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
  to_account   INT NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
  amount_out   NUMERIC(14,2) NOT NULL CHECK (amount_out > 0),
  per_usd_out  NUMERIC(18,6) NOT NULL CHECK (per_usd_out > 0),
  usd_out      NUMERIC(14,2) NOT NULL,
  amount_in    NUMERIC(14,2) NOT NULL CHECK (amount_in > 0),
  per_usd_in   NUMERIC(18,6) NOT NULL CHECK (per_usd_in > 0),
  usd_in       NUMERIC(14,2) NOT NULL,
  reference    TEXT,
  notes        TEXT,
  created_by   INT REFERENCES office_users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_account <> to_account)
);

-- Who did what, and failed logins (for lock-out).
CREATE TABLE office_activity (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id   INT REFERENCES office_users(id) ON DELETE SET NULL,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id INT,
  summary   TEXT
);
CREATE INDEX office_activity_at ON office_activity (at);
`,
  },
];
