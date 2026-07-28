import type { APIRoute } from 'astro';
import { clearSessionCookie } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async () =>
  new Response(null, {
    status: 302,
    headers: { 'Set-Cookie': clearSessionCookie(), Location: '/admin' },
  });
