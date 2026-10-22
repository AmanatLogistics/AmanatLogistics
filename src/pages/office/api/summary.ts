/**
 * Ledger figures as JSON (admin only) — used by scripts/office-verify.mjs to
 * check the ledger against an independent recalculation from the raw tables.
 */
import type { APIRoute } from 'astro';
import { currentUser } from '../../../lib/office/auth';
import { pnl, partyBalances, accountBalances, balanceTotals, shipmentFigures, cashFlow } from '../../../lib/office/ledger';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const user = await currentUser(request);
  if (!user || user.role !== 'admin') return new Response('Forbidden', { status: 403 });
  const from = url.searchParams.get('from') ?? '2000-01-01';
  const to = url.searchParams.get('to') ?? '2100-12-31';
  const period = { from, to };
  const [p, parties, accounts, totals, ships, cash] = await Promise.all([
    pnl(period),
    partyBalances(),
    accountBalances(),
    balanceTotals(),
    shipmentFigures(),
    cashFlow(period),
  ]);
  return new Response(
    JSON.stringify({ period, pnl: p, parties, accounts, totals, shipments: Object.fromEntries(ships), cashFlow: cash }, null, 2),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
};
