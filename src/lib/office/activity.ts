/**
 * Activity log — who created, changed or deleted what, and when. Shown on the
 * Users page and on each record, so a figure that changed can be traced.
 */
import { q, type Runner } from './db';

export async function logActivity(
  userId: number | null,
  action: string,
  entity: string | null,
  entityId: number | null,
  summary: string | null,
  runner?: Runner,
): Promise<void> {
  await q(
    'INSERT INTO office_activity (user_id, action, entity, entity_id, summary) VALUES ($1, $2, $3, $4, $5)',
    [userId, action, entity, entityId, summary],
    runner,
  );
}

export interface ActivityRow {
  id: number;
  at: string;
  user_name: string | null;
  action: string;
  entity: string | null;
  entity_id: number | null;
  summary: string | null;
}

export async function recentActivity(opts: { entity?: string; entityId?: number; limit?: number } = {}): Promise<ActivityRow[]> {
  const where: string[] = ["a.action <> 'login_failed'"];
  const params: unknown[] = [];
  if (opts.entity) {
    params.push(opts.entity);
    where.push(`a.entity = $${params.length}`);
  }
  if (opts.entityId) {
    params.push(opts.entityId);
    where.push(`a.entity_id = $${params.length}`);
  }
  params.push(opts.limit ?? 50);
  return q<ActivityRow>(
    `SELECT a.id, a.at, u.name AS user_name, a.action, a.entity, a.entity_id, a.summary
       FROM office_activity a LEFT JOIN office_users u ON u.id = a.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.at DESC LIMIT $${params.length}`,
    params,
  );
}

/**
 * Next number in a named sequence, e.g. nextNumber('invoice-2026') → 7.
 * Done with one atomic upsert, so two people saving at once never get the
 * same invoice or shipment number.
 */
export async function nextNumber(key: string, runner?: Runner): Promise<number> {
  const rows = await q<{ value: number }>(
    `INSERT INTO office_counters (key, value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET value = office_counters.value + 1
     RETURNING value`,
    [key],
    runner,
  );
  return rows[0].value;
}
