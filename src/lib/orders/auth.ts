/**
 * Orders admin (/orders/admin) — its own login.
 *
 * A third panel alongside the website admin and the shipment tracker, isolated
 * the same way: its own password and its own cookie name, so a session for one
 * panel is never accepted by another.
 *
 * In local dev, if unset, the fallback password is "orders123" (never in prod).
 */
import { env } from '../store';
import { makeSession } from '../session';

export function ordersPassword(): string | null {
  const configured = env('ORDERS_ADMIN_PASSWORD');
  if (configured) return configured;
  return import.meta.env.DEV ? 'orders123' : null;
}

const session = makeSession('amanat_orders', ordersPassword);

export function createOrdersCookie(): Promise<string> {
  return session.createCookie();
}

export function clearOrdersCookie(): string {
  return session.clearCookie();
}

export function isOrdersAdmin(request: Request): Promise<boolean> {
  return session.verify(request);
}
