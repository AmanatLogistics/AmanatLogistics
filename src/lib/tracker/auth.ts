/**
 * Shipment tracker admin (/tracking/admin) — its own login, separate from the
 * website content admin at /admin.
 *
 * Set TRACKER_ADMIN_PASSWORD in .env (local) and in Vercel env vars
 * (production). Because the cookie name and the signing key both differ from
 * the website admin's, a session for one panel is never accepted by the other.
 *
 * In local dev, if unset, the fallback password is "tracker123" (never in prod).
 */
import { env } from '../store';
import { makeSession } from '../session';

export function trackerPassword(): string | null {
  const configured = env('TRACKER_ADMIN_PASSWORD');
  if (configured) return configured;
  return import.meta.env.DEV ? 'tracker123' : null;
}

const session = makeSession('amanat_tracker', trackerPassword);

export function createTrackerCookie(): Promise<string> {
  return session.createCookie();
}

export function clearTrackerCookie(): string {
  return session.clearCookie();
}

export function isTrackerAdmin(request: Request): Promise<boolean> {
  return session.verify(request);
}
