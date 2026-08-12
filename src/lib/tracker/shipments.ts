/**
 * Shipment tracker — queries.
 *
 * Direct port of the SQL in src/Tracker/index.php, admin/dashboard.php,
 * admin/add.php, admin/edit.php and admin/delete.php. Every value is passed
 * through the tagged template, so it is sent as a bound parameter — the same
 * protection the PHP got from prepared statements.
 *
 * Dates are returned as 'YYYY-MM-DD' strings via to_char rather than as JS
 * Date objects, so a DATE column can never shift a day when it is formatted
 * in a different timezone than the server.
 */
import { db, ensureSchema } from './db';

export interface ShipmentStep {
  step_number: number;
  step_title: string;
  step_description: string;
  /** 'YYYY-MM-DD', or null while the stage has not been reached. */
  step_date: string | null;
  /** Free text, e.g. '10:30 AM'. */
  step_time: string | null;
}

export interface Shipment {
  id: number;
  tracking_number: string;
  invoice_number: string;
  customer_name: string;
  origin: string;
  destination: string;
  total_packages: number;
  total_weight: string;
  shipping_method: string;
  booking_date: string;
  estimated_delivery: string;
  whatsapp_number: string | null;
  current_step: number;
}

/** A dashboard row plus the title of the step it is currently sitting on. */
export interface ShipmentSummary extends Shipment {
  current_step_title: string | null;
}

export type ShipmentInput = Omit<Shipment, 'id'>;

export const STEP_COUNT = 8;

export const SHIPPING_METHODS = ['Sea Freight', 'Air Freight', 'Land Freight', 'Express'] as const;

/**
 * Seed titles for a new shipment (from admin/add.php). These are only defaults —
 * unlike the PHP, each shipment's step titles and descriptions are editable, so
 * route-specific stages like "In Salang" or "Hairatan Customs Clearance" can be
 * entered per shipment.
 */
export const DEFAULT_STEPS: { step_title: string; step_description: string }[] = [
  { step_title: 'Shipment Received', step_description: 'We have received your shipment at our origin office.' },
  { step_title: 'Custon Clearnce', step_description: 'Your shipment Waiting For Shipment Clearence.' },
  { step_title: 'Departed Origin', step_description: 'Your shipment has departed from origin.' },
  { step_title: 'In Salang', step_description: 'Your shipment is Passing Salang Pass.' },
  { step_title: 'Hairatan Customs Clearance', step_description: 'Your shipment is pending Hairatan customs clearance.' },
  { step_title: 'In Transit', step_description: 'Your shipment is In Transit To Tashkent.' },
  { step_title: 'Tashkent Airport', step_description: 'Your shipment is In Tashkent Airport.' },
  { step_title: 'Delivered', step_description: 'Your shipment has been delivered.' },
];

/** The 8 blank steps a brand-new shipment form starts from. */
export function blankSteps(): ShipmentStep[] {
  return DEFAULT_STEPS.map((s, i) => ({
    step_number: i + 1,
    step_title: s.step_title,
    step_description: s.step_description,
    step_date: null,
    step_time: null,
  }));
}

// Shared projection so dates always come back as plain strings.
const SHIPMENT_COLUMNS = `
  id, tracking_number, invoice_number, customer_name, origin, destination,
  total_packages, total_weight, shipping_method, whatsapp_number, current_step,
  to_char(booking_date, 'YYYY-MM-DD')       AS booking_date,
  to_char(estimated_delivery, 'YYYY-MM-DD') AS estimated_delivery
`;

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

async function stepsFor(shipmentId: number): Promise<ShipmentStep[]> {
  const sql = db();
  return (await sql`
    SELECT step_number, step_title, step_description, step_time,
           to_char(step_date, 'YYYY-MM-DD') AS step_date
    FROM shipment_steps
    WHERE shipment_id = ${shipmentId}
    ORDER BY step_number ASC
  `) as ShipmentStep[];
}

/**
 * Public lookup by tracking OR invoice number (index.php). Matching is
 * case-insensitive and ignores surrounding spaces, so a pasted code still works.
 */
export async function findByCode(
  code: string,
): Promise<{ shipment: Shipment; steps: ShipmentStep[] } | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  await ensureSchema();
  const sql = db();
  const rows = (await sql`
    SELECT ${sql.unsafe(SHIPMENT_COLUMNS)}
    FROM shipments
    WHERE lower(tracking_number) = lower(${trimmed})
       OR lower(invoice_number)  = lower(${trimmed})
    LIMIT 1
  `) as Shipment[];

  if (!rows.length) return null;
  return { shipment: rows[0], steps: await stepsFor(rows[0].id) };
}

/** Admin lookup by primary key, for the edit form. */
export async function findById(
  id: number,
): Promise<{ shipment: Shipment; steps: ShipmentStep[] } | null> {
  if (!Number.isInteger(id) || id <= 0) return null;

  await ensureSchema();
  const sql = db();
  const rows = (await sql`
    SELECT ${sql.unsafe(SHIPMENT_COLUMNS)} FROM shipments WHERE id = ${id}
  `) as Shipment[];

  if (!rows.length) return null;
  return { shipment: rows[0], steps: await stepsFor(rows[0].id) };
}

/**
 * Dashboard list, optionally filtered (dashboard.php). Joins in the *actual*
 * title of the current step — the PHP looked it up in a hardcoded array, so a
 * shipment on step 4 always displayed "In Transit" even when its real stage was
 * named something else.
 */
export async function listShipments(query = ''): Promise<ShipmentSummary[]> {
  await ensureSchema();
  const sql = db();
  const q = query.trim();
  const like = `%${q}%`;

  // Columns are spelled out (rather than reusing SHIPMENT_COLUMNS) because the
  // join makes bare `id` ambiguous between the two tables.
  return (await sql`
    SELECT s.id, s.tracking_number, s.invoice_number, s.customer_name,
           s.origin, s.destination, s.total_packages, s.total_weight,
           s.shipping_method, s.whatsapp_number, s.current_step,
           to_char(s.booking_date, 'YYYY-MM-DD')       AS booking_date,
           to_char(s.estimated_delivery, 'YYYY-MM-DD') AS estimated_delivery,
           st.step_title AS current_step_title
    FROM shipments s
    LEFT JOIN shipment_steps st
      ON st.shipment_id = s.id AND st.step_number = s.current_step
    WHERE ${q} = ''
       OR s.tracking_number ILIKE ${like}
       OR s.invoice_number  ILIKE ${like}
       OR s.customer_name   ILIKE ${like}
    ORDER BY s.created_at DESC
  `) as ShipmentSummary[];
}

/** True when another shipment already uses this tracking number (add/edit.php). */
export async function trackingNumberTaken(trackingNumber: string, exceptId = 0): Promise<boolean> {
  await ensureSchema();
  const sql = db();
  const rows = (await sql`
    SELECT 1 FROM shipments
    WHERE lower(tracking_number) = lower(${trackingNumber.trim()}) AND id <> ${exceptId}
    LIMIT 1
  `) as unknown[];
  return rows.length > 0;
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

/**
 * Steps are handed to Postgres as one JSON document and expanded with
 * jsonb_to_recordset, so the shipment and all 8 of its steps are written by a
 * single atomic statement instead of the PHP's 9 separate inserts.
 */
const STEP_RECORD = `s(
  step_number smallint, step_title text, step_description text,
  step_date date, step_time text
)`;

const stepsJson = (steps: ShipmentStep[]) =>
  JSON.stringify(
    steps.map((s) => ({
      step_number: s.step_number,
      step_title: s.step_title,
      step_description: s.step_description,
      // '' would fail the ::date cast — an unreached stage must be null.
      step_date: s.step_date || null,
      step_time: s.step_time || null,
    })),
  );

export async function createShipment(data: ShipmentInput, steps: ShipmentStep[]): Promise<number> {
  await ensureSchema();
  const sql = db();

  const rows = (await sql`
    WITH ins AS (
      INSERT INTO shipments (
        tracking_number, invoice_number, customer_name, origin, destination,
        total_packages, total_weight, shipping_method, booking_date,
        estimated_delivery, whatsapp_number, current_step
      ) VALUES (
        ${data.tracking_number}, ${data.invoice_number}, ${data.customer_name},
        ${data.origin}, ${data.destination}, ${data.total_packages},
        ${data.total_weight}, ${data.shipping_method}, ${data.booking_date},
        ${data.estimated_delivery}, ${data.whatsapp_number}, ${data.current_step}
      )
      RETURNING id
    ), new_steps AS (
      INSERT INTO shipment_steps (
        shipment_id, step_number, step_title, step_description, step_date, step_time
      )
      SELECT ins.id, s.step_number, s.step_title, s.step_description, s.step_date, s.step_time
      FROM ins, jsonb_to_recordset(${stepsJson(steps)}::jsonb) AS ${sql.unsafe(STEP_RECORD)}
    )
    SELECT id FROM ins
  `) as { id: number }[];

  return rows[0].id;
}

export async function updateShipment(
  id: number,
  data: ShipmentInput,
  steps: ShipmentStep[],
): Promise<void> {
  await ensureSchema();
  const sql = db();

  // Steps are upserted rather than deleted-and-reinserted: the UNIQUE
  // (shipment_id, step_number) constraint is checked immediately, so a delete
  // and an insert of the same key inside one statement would collide.
  await sql.transaction([
    sql`
      UPDATE shipments SET
        tracking_number = ${data.tracking_number},
        invoice_number  = ${data.invoice_number},
        customer_name   = ${data.customer_name},
        origin          = ${data.origin},
        destination     = ${data.destination},
        total_packages  = ${data.total_packages},
        total_weight    = ${data.total_weight},
        shipping_method = ${data.shipping_method},
        booking_date    = ${data.booking_date},
        estimated_delivery = ${data.estimated_delivery},
        whatsapp_number = ${data.whatsapp_number},
        current_step    = ${data.current_step},
        updated_at      = now()
      WHERE id = ${id}
    `,
    sql`
      INSERT INTO shipment_steps (
        shipment_id, step_number, step_title, step_description, step_date, step_time
      )
      SELECT ${id}, s.step_number, s.step_title, s.step_description, s.step_date, s.step_time
      FROM jsonb_to_recordset(${stepsJson(steps)}::jsonb) AS ${sql.unsafe(STEP_RECORD)}
      ON CONFLICT (shipment_id, step_number) DO UPDATE SET
        step_title       = EXCLUDED.step_title,
        step_description = EXCLUDED.step_description,
        step_date        = EXCLUDED.step_date,
        step_time        = EXCLUDED.step_time
    `,
  ]);
}

/** Steps go with it via ON DELETE CASCADE (delete.php). */
export async function deleteShipment(id: number): Promise<void> {
  await ensureSchema();
  const sql = db();
  await sql`DELETE FROM shipments WHERE id = ${id}`;
}
