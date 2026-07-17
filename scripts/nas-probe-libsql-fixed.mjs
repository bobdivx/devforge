import { createRequire } from 'node:module';

const require = createRequire('/app/package.json');
const { createClient } = require('@libsql/client');

const host = 'btnfrll4ubmua4nvk73y4h6u';
const token = process.env.TURSO_AUTH_TOKEN || '';
const url = process.env.TURSO_DATABASE_URL || `libsql://${host}:8080`;

function toBase64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function resolveLibsqlClientOptions(rawUrl, authToken, authUser = 'libsql') {
  const trimmed = rawUrl.trim();
  const isCloud = (() => {
    try {
      const hostname = new URL(trimmed.replace(/^libsql:/i, 'https:')).hostname.toLowerCase();
      return hostname.endsWith('.turso.io');
    } catch {
      return false;
    }
  })();

  const isSelfHosted =
    !isCloud &&
    (trimmed.startsWith('http://') ||
      (trimmed.startsWith('libsql://') && Boolean(new URL(trimmed.replace(/^libsql:/i, 'http:')).port)));

  if (!isSelfHosted) {
    return { url: trimmed, authToken };
  }

  const parsed = new URL(trimmed.replace(/^libsql:/i, 'http:'));
  const user = decodeURIComponent(parsed.username || authUser);
  const password = decodeURIComponent(parsed.password || authToken);
  parsed.username = '';
  parsed.password = '';
  const cleanUrl = parsed.toString().replace(/\/$/, '');
  const basic = toBase64(`${user}:${password}`);

  return {
    url: cleanUrl,
    fetch: (input, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Basic ${basic}`);
      return fetch(input, { ...init, headers });
    },
  };
}

const opts = resolveLibsqlClientOptions(url, token);
console.log('resolved url', opts.url, 'hasCustomFetch', typeof opts.fetch === 'function');
const client = createClient(opts);
const rs = await client.execute('select count(*) as n from videos');
console.log('OK videos=', rs.rows[0]?.n);
const rs2 = await client.execute('select count(*) as n from prototypes');
console.log('OK prototypes=', rs2.rows[0]?.n);
