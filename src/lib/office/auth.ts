/**
 * Amanat Office — staff accounts and sessions.
 *
 * Each person has their own username and password (unlike the website admin's
 * single shared password), so the activity log can say who entered what.
 *
 * Roles
 *   admin  everything: dashboards with profit, users, settings, deleting records
 *   staff  day-to-day entry: shipments, payments, expenses, invoices — but no
 *          profit figures, no users, no settings, no deleting
 *
 * First sign-in: while there are no users yet, signing in with the username
 * OFFICE_OWNER_USERNAME (default "owner") and the password in
 * OFFICE_OWNER_PASSWORD creates that first admin. After that the env password
 * does nothing — people are managed on the Users page. Locally, with nothing
 * set, the first sign-in is owner / office123.
 *
 * Sessions are a signed cookie: user id + expiry + an HMAC that also covers the
 * time the password was last changed, so changing a password (or disabling a
 * user) ends every session that user had.
 */
import { scrypt as _scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import type { AstroGlobal } from 'astro';
import { env } from '../store';
import { one, q, isConfigured } from './db';
import { logActivity } from './activity';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const COOKIE = 'amanat_office';
const SESSION_HOURS = 12;

export type Role = 'admin' | 'staff';

export interface OfficeUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  active: boolean;
  pw_changed_at: string;
}

/* ---------- passwords ---------- */

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, saltHex, hashHex] = stored.split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = await scrypt(pw, Buffer.from(saltHex, 'hex'), 32);
  const want = Buffer.from(hashHex, 'hex');
  return want.length === hash.length && timingSafeEqual(want, hash);
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  return null;
}

/* ---------- session secret ---------- */

function secret(): string | null {
  const s = env('OFFICE_SESSION_SECRET') || env('OFFICE_OWNER_PASSWORD');
  if (s) return s;
  return import.meta.env.DEV ? 'local-dev-office-secret' : null;
}

export function ownerUsername(): string {
  return (env('OFFICE_OWNER_USERNAME') || 'owner').trim().toLowerCase();
}

function ownerPassword(): string | null {
  return env('OFFICE_OWNER_PASSWORD') || (import.meta.env.DEV ? 'office123' : null);
}

/** Is the office usable at all on this deployment? */
export function setupProblem(): string | null {
  if (!isConfigured()) return 'The office database is not connected.';
  if (!secret()) return 'OFFICE_OWNER_PASSWORD is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.';
  return null;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()!).update(payload).digest('hex');
}

function stamp(u: Pick<OfficeUser, 'pw_changed_at'>): string {
  return String(new Date(u.pw_changed_at).getTime());
}

export function sessionCookie(u: OfficeUser): string {
  const exp = Date.now() + SESSION_HOURS * 3_600_000;
  const body = `${u.id}.${exp}`;
  const sig = sign(`${body}.${stamp(u)}`);
  const secure = import.meta.env.PROD ? ' Secure;' : '';
  return `${COOKIE}=${body}.${sig}; Path=/office; HttpOnly;${secure} SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`;
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/office; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** The signed-in user for this request, or null. */
export async function currentUser(request: Request): Promise<OfficeUser | null> {
  if (setupProblem()) return null;
  const m = (request.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [idStr, expStr, sig] = m[1].split('.');
  const id = Number(idStr);
  const exp = Number(expStr);
  if (!id || !exp || !sig || exp < Date.now()) return null;
  const u = await one<OfficeUser>(
    'SELECT id, username, name, role, active, pw_changed_at FROM office_users WHERE id = $1',
    [id],
  );
  if (!u || !u.active) return null;
  const want = sign(`${id}.${exp}.${stamp(u)}`);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  return u;
}

/* ---------- page guard ---------- */

/**
 * At the top of every /office page:
 *
 *   const user = await guard(Astro);
 *   if (user instanceof Response) return user;
 *
 * Signed out → sent to the login page (and back here afterwards).
 * `{ admin: true }` → staff users get a 403 page instead.
 */
export async function guard(Astro: AstroGlobal, opts: { admin?: boolean } = {}): Promise<OfficeUser | Response> {
  const user = await currentUser(Astro.request);
  if (!user) {
    const next = Astro.url.pathname + Astro.url.search;
    return Astro.redirect(`/office/login?next=${encodeURIComponent(next)}`);
  }
  if (opts.admin && user.role !== 'admin') {
    return new Response('Only an admin can open this page.', { status: 403, headers: { 'content-type': 'text/plain' } });
  }
  return user;
}

export const isAdmin = (u: OfficeUser | null | undefined) => u?.role === 'admin';

/**
 * Reject a POST that did not come from our own pages. Browsers always send
 * Origin on a form POST; a missing or foreign one is not ours.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/* ---------- signing in ---------- */

const MAX_FAILS = 8;
const LOCK_MINUTES = 15;

export type LoginResult = { ok: true; user: OfficeUser } | { ok: false; error: string };

export async function login(usernameRaw: string, password: string): Promise<LoginResult> {
  const problem = setupProblem();
  if (problem) return { ok: false, error: problem };
  const username = usernameRaw.trim().toLowerCase();
  if (!username || !password) return { ok: false, error: 'Enter your username and password.' };

  const recent = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM office_activity
      WHERE action = 'login_failed' AND summary = $1 AND at > now() - make_interval(mins => $2)`,
    [username, LOCK_MINUTES],
  );
  if ((recent?.n ?? 0) >= MAX_FAILS) {
    return { ok: false, error: `Too many wrong attempts. Try again in ${LOCK_MINUTES} minutes.` };
  }

  // First ever sign-in creates the owner from the environment password.
  const count = await one<{ n: number }>('SELECT COUNT(*) AS n FROM office_users');
  if ((count?.n ?? 0) === 0) {
    const ownerPw = ownerPassword();
    if (ownerPw && username === ownerUsername() && password === ownerPw) {
      const user = await one<OfficeUser>(
        `INSERT INTO office_users (username, name, password_hash, role)
         VALUES ($1, $2, $3, 'admin')
         RETURNING id, username, name, role, active, pw_changed_at`,
        [username, 'Owner', await hashPassword(password)],
      );
      await logActivity(user!.id, 'user_created', 'user', user!.id, 'First sign-in created the owner account');
      return { ok: true, user: user! };
    }
  }

  const row = await one<OfficeUser & { password_hash: string }>(
    'SELECT id, username, name, role, active, pw_changed_at, password_hash FROM office_users WHERE username = $1',
    [username],
  );
  if (!row || !row.active || !(await checkPassword(password, row.password_hash))) {
    await logActivity(null, 'login_failed', 'user', row?.id ?? null, username);
    return { ok: false, error: 'Wrong username or password.' };
  }
  await q('UPDATE office_users SET last_login_at = now() WHERE id = $1', [row.id]);
  await logActivity(row.id, 'login', 'user', row.id, null);
  const { password_hash: _ignored, ...user } = row;
  return { ok: true, user };
}

/** Only allow redirecting back to an office page after login. */
export function safeNext(next: string | null): string {
  if (next && next.startsWith('/office') && !next.startsWith('//')) return next;
  return '/office';
}
