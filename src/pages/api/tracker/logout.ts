import type { APIRoute } from 'astro';
import { clearTrackerCookie } from '../../../lib/tracker/auth';

export const prerender = false;

export const POST: APIRoute = async () =>
  new Response(null, {
    status: 303,
    headers: { 'Set-Cookie': clearTrackerCookie(), Location: '/tracking/admin' },
  });
