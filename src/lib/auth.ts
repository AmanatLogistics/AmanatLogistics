/**
 * Admin authentication — password login → signed, HttpOnly session cookie.
 *
 * Set ADMIN_PASSWORD in .env (local) and in Vercel env vars (production).
 * In local dev, if unset, the fallback password is "admin123" (never in prod).
 */
import { env } from './store';

const COOKIE = 'amanat_admin';
const SESSION_DAYS = 7;

export function adminPassword(): string | null {
  const configured = env('ADMIN_PASSWORD');
  if (configured) return configured;
  return import.meta.env.DEV ? 'admin123' : null;
}

async function hmac(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSessionCookie(): Promise<string> {
  const secret = adminPassword();
  if (!secret) throw new Error('ADMIN_PASSWORD not set');
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const sig = await hmac(String(expires), secret);
  const value = `${expires}.${sig}`;
  const secure = import.meta.env.PROD ? ' Secure;' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function isAdmin(request: Request): Promise<boolean> {
  const secret = adminPassword();
  if (!secret) return false;
  const cookies = request.headers.get('cookie') ?? '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return false;
  const [expStr, sig] = match[1].split('.');
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now()) return false;
  return (await hmac(expStr, secret)) === sig;
}
