/** Download a CSV template for one kind of record (admin only). */
import type { APIRoute } from 'astro';
import { currentUser } from '../../../../lib/office/auth';
import { isKind, templateCsv } from '../../../../lib/office/importer';

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  const user = await currentUser(request);
  if (!user || user.role !== 'admin') return new Response('Forbidden', { status: 403 });
  const kind = String(params.kind ?? '').replace(/\.csv$/, '');
  if (!isKind(kind)) return new Response('Unknown template', { status: 404 });
  return new Response(templateCsv(kind), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="amanat-${kind}-template.csv"`,
      'cache-control': 'no-store',
    },
  });
};
