/**
 * Reading posted forms safely. Every field is optional text until a helper
 * says otherwise; the helpers never throw — they return null for "missing or
 * not a valid X", and the page decides whether that is an error.
 */

export function str(fd: FormData, name: string, max = 500): string | null {
  const v = fd.get(name);
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
}

/** Numbers as people type them: "1,250.50", " 70 ", "12 700". */
export function parseNum(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = String(v).replace(/[,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function num(fd: FormData, name: string): number | null {
  return parseNum(fd.get(name));
}

export function int(fd: FormData, name: string): number | null {
  const n = num(fd, name);
  return n === null ? null : Math.trunc(n);
}

export function date(fd: FormData, name: string): string | null {
  const v = str(fd, name, 10);
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  // Date.parse('2026-02-30') is valid in V8 (it rolls into March); a real
  // calendar day survives the round trip unchanged.
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

export function oneOf<T extends string>(fd: FormData, name: string, allowed: readonly T[] | Record<T, unknown>): T | null {
  const v = str(fd, name, 50);
  const list = Array.isArray(allowed) ? allowed : Object.keys(allowed);
  return v && (list as string[]).includes(v) ? (v as T) : null;
}

/**
 * Repeated rows from a line-item editor: inputs named `charge[0][amount]`,
 * `charge[1][amount]`… come back as [{ amount: '…' }, …] in index order.
 * Rows whose every field is blank are dropped.
 */
export function rows(fd: FormData, prefix: string): Record<string, string>[] {
  const out = new Map<number, Record<string, string>>();
  const re = new RegExp(`^${prefix}\\[(\\d+)\\]\\[(\\w+)\\]$`);
  for (const [k, v] of fd.entries()) {
    const m = k.match(re);
    if (!m || typeof v !== 'string') continue;
    const i = Number(m[1]);
    if (!out.has(i)) out.set(i, {});
    out.get(i)![m[2]] = v.trim();
  }
  return [...out.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, r]) => r)
    .filter((r) => Object.values(r).some((v) => v !== ''));
}

/** Build a redirect with a one-line message shown by <Flash />. */
export function withMsg(path: string, msg: string, kind: 'ok' | 'err' = 'ok'): string {
  const u = new URL(path, 'http://x');
  u.searchParams.set(kind, msg);
  return u.pathname + u.search;
}
