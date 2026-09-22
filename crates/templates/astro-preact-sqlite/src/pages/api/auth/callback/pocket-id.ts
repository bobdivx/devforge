import type { APIRoute } from 'astro';
import {
  SESSION_COOKIE,
  TX_COOKIE,
  discover,
  exchangeCode,
  fetchUser,
  isHttps,
  oidcSettings,
  redirectUri,
  unsignPayload,
  writeSession,
} from '../../../../lib/oidc';

export const GET: APIRoute = async ({ request, cookies, redirect, url }) => {
  const fail = (message: string) =>
    redirect('/?auth_error=' + encodeURIComponent(message), 302);

  const cfg = oidcSettings();
  if (!cfg.configured) return fail('Pocket ID non configuré sur cette app');

  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    return fail(url.searchParams.get('error_description') || 'Connexion Pocket ID refusée');
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return fail('Réponse Pocket ID incomplète');

  const raw = cookies.get(TX_COOKIE)?.value;
  cookies.delete(TX_COOKIE, { path: '/' });
  if (!raw) return fail('Session de connexion expirée');
  const payload = unsignPayload(raw, cfg.clientSecret);
  if (!payload) return fail('Session de connexion invalide');

  let tx: { state: string; verifier: string; exp?: number };
  try {
    tx = JSON.parse(payload);
  } catch {
    return fail('Session de connexion invalide');
  }
  if (tx.state !== state) return fail('State OIDC invalide');
  if (typeof tx.exp === 'number' && tx.exp < Date.now() / 1000) return fail('Session de connexion expirée');

  try {
    const endpoints = await discover(cfg.issuer);
    const access = await exchangeCode({
      tokenEndpoint: endpoints.token,
      code,
      redirect: redirectUri(request),
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      verifier: tx.verifier,
    });
    const user = await fetchUser(endpoints.userinfo, access);
    cookies.set(SESSION_COOKIE, writeSession(user, cfg.clientSecret), {
      httpOnly: true,
      secure: isHttps(request),
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return redirect('/', 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connexion Pocket ID impossible';
    return fail(message);
  }
};
