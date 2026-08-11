/**
 * Signed session cookies — shared by the two independent admin panels.
 *
 *   /admin           → website content editor   (see lib/auth.ts)
 *   /tracking/admin  → shipment tracker         (see lib/tracker/auth.ts)
 *
 * Each panel calls makeSession() with its own cookie name and its own password,
 * so the two are fully isolated: a session for one is never valid for the other.
 *
 * The cookie carries no secrets — only an expiry timestamp and an HMAC of that
 * timestamp keyed by the panel's password. Changing the password therefore
 * invalidates every outstanding session for that panel.
 */

const SESSION_DAYS = 7;

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

/** Constant-time comparison, so a wrong signature leaks no timing information. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface Session {
  /** Set-Cookie value that starts a logged-in session. */
  createCookie(): Promise<string>;
  /** Set-Cookie value that ends it. */
  clearCookie(): string;
  /** Does this request carry a valid, unexpired session? */
  verify(request: Request): Promise<boolean>;
}

export function makeSession(cookieName: string, getSecret: () => string | null): Session {
  return {
    async createCookie() {
      const secret = getSecret();
      if (!secret) throw new Error(`No password configured for "${cookieName}"`);
      const expires = Date.now() + SESSION_DAYS * 86_400_000;
      const value = `${expires}.${await hmac(String(expires), secret)}`;
      const secure = import.meta.env.PROD ? ' Secure;' : '';
      return `${cookieName}=${value}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
    },

    clearCookie() {
      return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    },

    async verify(request) {
      const secret = getSecret();
      if (!secret) return false;
      const cookies = request.headers.get('cookie') ?? '';
      const match = cookies.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
      if (!match) return false;
      const [expStr, sig] = match[1].split('.');
      const exp = Number(expStr);
      if (!exp || !sig || exp < Date.now()) return false;
      return safeEqual(await hmac(expStr, secret), sig);
    },
  };
}

/**
 * Reject cross-site form posts. Browsers always send Origin on POST, so a
 * missing or foreign Origin means the request did not come from our own pages.
 * (SameSite=Lax already blocks most of this; this closes the rest.)
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
