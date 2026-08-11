/**
 * Website content admin (/admin) — password login → signed, HttpOnly cookie.
 *
 * Set ADMIN_PASSWORD in .env (local) and in Vercel env vars (production).
 * In local dev, if unset, the fallback password is "admin123" (never in prod).
 *
 * The shipment tracker admin (/tracking/admin) is deliberately separate and
 * uses its own password and cookie — see lib/tracker/auth.ts.
 */
import { env } from './store';
import { makeSession } from './session';

export function adminPassword(): string | null {
  const configured = env('ADMIN_PASSWORD');
  if (configured) return configured;
  return import.meta.env.DEV ? 'admin123' : null;
}

const session = makeSession('amanat_admin', adminPassword);

export function createSessionCookie(): Promise<string> {
  return session.createCookie();
}

export function clearSessionCookie(): string {
  return session.clearCookie();
}

export function isAdmin(request: Request): Promise<boolean> {
  return session.verify(request);
}
