import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/oidc';

export const GET: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/', 302);
};
