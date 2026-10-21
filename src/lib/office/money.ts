/**
 * Money helpers. Every report in the office system is in US dollars; each
 * record keeps its own currency and rate too (see schema.ts).
 */
import { q } from './db';

/** Round to cents, without 1.005 → 1.00 surprises. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Dollar value of `amount` in a currency worth `perUsd` units per dollar. */
export function toUsd(amount: number, perUsd: number): number {
  if (!perUsd || perUsd <= 0) return 0;
  return round2(amount / perUsd);
}

export interface Currency {
  code: string;
  name: string;
  per_usd: number;
}

export async function listCurrencies(): Promise<Currency[]> {
  return q<Currency>('SELECT code, name, per_usd FROM office_currencies ORDER BY (code = \'USD\') DESC, code');
}

/** code → current default rate, for pre-filling forms. */
export async function rateMap(): Promise<Record<string, number>> {
  const rows = await listCurrencies();
  return Object.fromEntries(rows.map((c) => [c.code, c.per_usd]));
}

const SYMBOL: Record<string, string> = { USD: '$', AED: 'AED ', AFN: '؋', CNY: '¥', UZS: 'UZS ', PKR: 'Rs ' };

/** "$1,250.00", "؋87,500", "UZS 1,270,000" — what a person would write. */
export function fmtMoney(amount: number | null | undefined, currency = 'USD'): string {
  const n = Number(amount ?? 0);
  const whole = currency === 'AFN' || currency === 'UZS' || currency === 'PKR';
  const s = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  const sym = SYMBOL[currency] ?? `${currency} `;
  return `${n < 0 ? '−' : ''}${sym}${s}`;
}

/** Dollars, the reporting currency. */
export function usd(amount: number | null | undefined): string {
  return fmtMoney(amount, 'USD');
}

/** Plain number with thousands separators (kg, CBM, pieces). */
export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** 2026-10-21 → 21 Oct 2026 */
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const s = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const [y, m, day] = s.split('-').map(Number);
  if (!y || !m || !day) return String(d);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[m - 1]} ${y}`;
}

/** Today in Afghanistan (UTC+4:30), as YYYY-MM-DD — the office's calendar day. */
export function today(): string {
  return new Date(Date.now() + 4.5 * 3_600_000).toISOString().slice(0, 10);
}

export const METHODS = {
  cash: 'Cash',
  hawala: 'Hawala',
  bank: 'Bank transfer',
  sarafi: 'Sarafi',
  other: 'Other',
} as const;
export type Method = keyof typeof METHODS;
