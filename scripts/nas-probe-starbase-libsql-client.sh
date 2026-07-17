#!/bin/sh
set -eu
APP=$(docker ps --filter name=julfme7qvjx8tzzypz6qzea0 --format '{{.Names}}' | head -1)
DB=btnfrll4ubmua4nvk73y4h6u
TOKEN=$(docker exec "$APP" printenv TURSO_AUTH_TOKEN)
echo "APP=$APP token_len=${#TOKEN}"

# Probe raw https vs http (expect https to fail without TLS)
docker exec "$APP" node <<'NODE'
const http = require('http');
const https = require('https');
const net = require('net');

function get(mod, url) {
  return new Promise((resolve) => {
    const req = mod.get(url, { timeout: 3000 }, (res) => {
      resolve(`${url} -> ${res.statusCode}`);
      res.resume();
    });
    req.on('error', (e) => resolve(`${url} -> ERR ${e.message}`));
    req.on('timeout', () => { req.destroy(); resolve(`${url} -> TIMEOUT`); });
  });
}

(async () => {
  const host = 'btnfrll4ubmua4nvk73y4h6u';
  console.log(await get(http, `http://${host}:8080/v2`));
  console.log(await get(https, `https://${host}:8080/v2`));
})();
NODE

# Try @libsql/client if present in app
docker exec "$APP" node <<NODE
async function main() {
  const token = process.env.TURSO_AUTH_TOKEN;
  const candidates = [
    process.env.TURSO_DATABASE_URL,
    process.env.LIBSQL_URL,
    'http://btnfrll4ubmua4nvk73y4h6u:8080',
    'http://libsql:' + token + '@btnfrll4ubmua4nvk73y4h6u:8080',
  ];
  let createClient;
  try {
    ({ createClient } = await import('@libsql/client'));
    console.log('using @libsql/client');
  } catch (e) {
    try {
      ({ createClient } = await import('@libsql/client/node'));
      console.log('using @libsql/client/node');
    } catch (e2) {
      console.log('no @libsql/client in app:', e2.message);
      // fallback: inspect how astro resolves URL if package exists elsewhere
      const fs = require('fs');
      const paths = [
        '/app/node_modules/@libsql/client/package.json',
        '/app/dist/node_modules/@libsql/client/package.json',
        process.cwd() + '/node_modules/@libsql/client/package.json',
      ];
      for (const p of paths) {
        console.log(p, fs.existsSync(p) ? 'exists' : 'missing');
      }
      return;
    }
  }
  for (const url of candidates.filter(Boolean)) {
    const redacted = String(url).replace(/:[^:@/]+@/, ':***@');
    try {
      const client = createClient({ url, authToken: token });
      const rs = await client.execute('select 1 as ok');
      console.log('OK', redacted, JSON.stringify(rs.rows));
      client.close?.();
    } catch (err) {
      console.log('FAIL', redacted, err && (err.message || String(err)));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
NODE

echo "=== find libsql packages ==="
docker exec "$APP" sh -c 'find /app /home /opt /nix -name "package.json" 2>/dev/null | xargs grep -l "\"@libsql/client\"" 2>/dev/null | head -20; ls -la /app 2>/dev/null | head -30; ls -la 2>/dev/null | head -20; pwd' || true
