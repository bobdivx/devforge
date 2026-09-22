import type { APIRoute } from 'astro';
import {
  TX_COOKIE,
  authorizationUrl,
  createTx,
  discover,
  isHttps,
  oidcSettings,
  redirectUri,
  signPayload,
} from '../../../lib/oidc';

export const GET: APIRoute = async ({ request, cookies, redirect }) => {
  const cfg = oidcSettings();
  if (!cfg.configured) {
    return redirect('/?auth_error=' + encodeURIComponent('Pocket ID non configuré sur cette app'), 302);
  }
  const tx = createTx();
  const redirectTo = redirectUri(request);
  const endpoints = await discover(cfg.issuer);
  const url = authorizationUrl(endpoints, cfg.clientId, redirectTo, tx);
  cookies.set(
    TX_COOKIE,
    signPayload(JSON.stringify({ ...tx, exp: Math.floor(Date.now() / 1000) + 600 }), cfg.clientSecret),
    {
      httpOnly: true,
      secure: isHttps(request),
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    },
  );
  return redirect(url, 302);
};
