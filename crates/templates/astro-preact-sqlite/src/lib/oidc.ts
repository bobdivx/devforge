import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export type OidcUser = {
  sub: string;
  email: string;
  name: string;
};

type Endpoints = {
  authorization: string;
  token: string;
  userinfo: string;
};

const SESSION_COOKIE = 'df_user';
const TX_COOKIE = 'oidc_tx';

export { SESSION_COOKIE, TX_COOKIE };

export function oidcSettings() {
  const issuer = (
    process.env.OIDC_ISSUER ||
    process.env.AUTH_POCKET_ID_ISSUER ||
    process.env.POCKET_ID_URL ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
  const clientId = (process.env.OIDC_CLIENT_ID || process.env.AUTH_POCKET_ID_ID || '').trim();
  const clientSecret = (process.env.OIDC_CLIENT_SECRET || process.env.AUTH_POCKET_ID_SECRET || '').trim();
  return {
    issuer,
    clientId,
    clientSecret,
    configured: Boolean(issuer && clientId && clientSecret),
  };
}

export function isHttps(request: Request): boolean {
  const fwd = request.headers.get('x-forwarded-proto');
  if (fwd) return fwd.split(',')[0].trim() === 'https';
  return new URL(request.url).protocol === 'https:';
}

export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto = isHttps(request) ? 'https' : 'http';
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
    request.headers.get('host') ||
    url.host;
  return `${proto}://${host}`;
}

export function redirectUri(request: Request): string {
  return `${publicOrigin(request)}/api/auth/callback/pocket-id`;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function signPayload(payload: string, secret: string): string {
  const body = Buffer.from(payload).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function unsignPayload(token: string, secret: string): string | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return Buffer.from(body, 'base64url').toString('utf8');
}

export function readSession(token: string | undefined): OidcUser | null {
  const { clientSecret, configured } = oidcSettings();
  if (!configured || !token) return null;
  const raw = unsignPayload(token, clientSecret);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as OidcUser & { exp?: number };
    if (!data.email || !data.sub) return null;
    if (typeof data.exp === 'number' && data.exp < Date.now() / 1000) return null;
    return { sub: data.sub, email: data.email, name: data.name || data.email };
  } catch {
    return null;
  }
}

export function writeSession(user: OidcUser, secret: string): string {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
  return signPayload(JSON.stringify({ ...user, exp }), secret);
}

export function createTx(): { state: string; nonce: string; verifier: string; challenge: string } {
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { state, nonce, verifier, challenge };
}

let cached: { issuer: string; endpoints: Endpoints } | null = null;

export async function discover(issuer: string): Promise<Endpoints> {
  if (cached?.issuer === issuer) return cached.endpoints;
  const fallback: Endpoints = {
    authorization: `${issuer}/authorize`,
    token: `${issuer}/api/oidc/token`,
    userinfo: `${issuer}/api/oidc/userinfo`,
  };
  try {
    const res = await fetch(`${issuer}/.well-known/openid-configuration`);
    if (!res.ok) return fallback;
    const doc = (await res.json()) as {
      authorization_endpoint?: string;
      token_endpoint?: string;
      userinfo_endpoint?: string;
    };
    const endpoints: Endpoints = {
      authorization: doc.authorization_endpoint || fallback.authorization,
      token: doc.token_endpoint || fallback.token,
      userinfo: doc.userinfo_endpoint || fallback.userinfo,
    };
    cached = { issuer, endpoints };
    return endpoints;
  } catch {
    return fallback;
  }
}

export function authorizationUrl(
  endpoints: Endpoints,
  clientId: string,
  redirect: string,
  tx: { state: string; nonce: string; challenge: string },
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    scope: 'openid email profile',
    state: tx.state,
    nonce: tx.nonce,
    code_challenge: tx.challenge,
    code_challenge_method: 'S256',
  });
  return `${endpoints.authorization}?${params.toString()}`;
}

export async function exchangeCode(opts: {
  tokenEndpoint: string;
  code: string;
  redirect: string;
  clientId: string;
  clientSecret: string;
  verifier: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirect,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code_verifier: opts.verifier,
  });
  const res = await fetch(opts.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    throw new Error('échange du code refusé');
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('access_token manquant');
  return json.access_token;
}

export async function fetchUser(userinfoEndpoint: string, accessToken: string): Promise<OidcUser> {
  const res = await fetch(userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('userinfo refusé');
  const json = (await res.json()) as { sub?: string; email?: string; name?: string; preferred_username?: string };
  const email = (json.email || '').trim();
  const sub = (json.sub || '').trim();
  if (!email || !sub) throw new Error('email Pocket ID manquant');
  return {
    sub,
    email,
    name: (json.name || json.preferred_username || email).trim(),
  };
}
