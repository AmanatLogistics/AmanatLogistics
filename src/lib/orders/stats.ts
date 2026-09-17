/**
 * The home page's trust numbers, worked out from the real SHIPMENTS sheet.
 *
 * They used to be typed in by hand — "500+ tons delivered", "1,200+ orders
 * completed" — which meant they were only ever as true as the last time someone
 * remembered to edit them. The sheet already knows: it has a row per ACCI
 * invoice, a gross weight on each, and a stage that says whether it reached
 * Delhi. So count it.
 *
 * Two rules this must never break:
 *
 *   • the public home page must not wait on Google. The result is cached for an
 *     hour per server instance, and a cold instance that cannot reach the sheet
 *     falls straight back to the numbers set in /admin.
 *   • a failure is invisible to the visitor. If the sheet is unreachable — as it
 *     is whenever the Apps Script deployment is out of date — the page shows the
 *     admin's own figures exactly as it did before.
 */
import { listOrders, type SheetOrder } from './api';
import { ORDER_STAGE_COUNT } from './model';

export interface LiveStats {
  /** Shipments that reached Delhi. */
  delivered: number;
  /** Their combined gross weight, in tonnes. */
  tonnes: number;
  /** Every row in the sheet, delivered or not. */
  shipments: number;
}

/**
 * An hour is the right order of magnitude: these numbers move a few times a
 * week, and nobody visiting the home page needs them fresher than that.
 */
const CACHE_MS = 60 * 60 * 1000;
let cache: { value: LiveStats | null; at: number } | null = null;

const isDelivered = (o: SheetOrder) => o.stage >= ORDER_STAGE_COUNT;

export function computeStats(orders: SheetOrder[]): LiveStats {
  let kg = 0;
  let delivered = 0;
  for (const order of orders) {
    if (!isDelivered(order)) continue;
    delivered++;
    const weight = Number(order.gross_weight);
    if (Number.isFinite(weight) && weight > 0) kg += weight;
  }
  return { delivered, tonnes: kg / 1000, shipments: orders.length };
}

/** Null when the sheet cannot be read — the caller then keeps its own numbers. */
export async function liveStats(): Promise<LiveStats | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  let value: LiveStats | null = null;
  try {
    const { orders } = await listOrders();
    value = computeStats(orders);
  } catch (e) {
    // Never surfaced to a visitor: the home page simply keeps the admin's
    // figures. Logged so a broken sheet is still findable.
    console.error('Live stats unavailable, falling back to the admin values:', e);
  }

  // The failure is cached too, so an unreachable sheet is not retried on every
  // single request while it is down.
  cache = { value, at: Date.now() };
  return value;
}

/** 1240.5 -> "1,240+"; small numbers are not rounded up to something untrue. */
export function roundedPlus(n: number): string {
  if (n < 10) return String(Math.floor(n));
  const step = n >= 1000 ? 100 : n >= 100 ? 50 : 10;
  const floored = Math.floor(n / step) * step;
  return `${floored.toLocaleString('en-US')}+`;
}
