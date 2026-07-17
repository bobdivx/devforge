import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const host = 'btnfrll4ubmua4nvk73y4h6u';
const token = process.env.TURSO_AUTH_TOKEN || '';

function get(mod, url) {
  return new Promise((resolve) => {
    const req = mod.get(url, { timeout: 3000 }, (res) => {
      resolve(`${url} -> ${res.statusCode}`);
      res.resume();
    });
    req.on('error', (e) => resolve(`${url} -> ERR ${e.message}`));
    req.on('timeout', () => {
      req.destroy();
      resolve(`${url} -> TIMEOUT`);
    });
  });
}

function redact(url) {
  return String(url).replace(/:[^:@/]+@/, ':***@');
}

async function findCreateClient() {
  const require = createRequire(import.meta.url);
  const candidates = [
    '@libsql/client',
    '@libsql/client/node',
    path.join(process.cwd(), 'node_modules/@libsql/client'),
    '/app/node_modules/@libsql/client',
    '/app/dist/client/node_modules/@libsql/client',
  ];

  for (const id of candidates) {
    try {
      const mod = await import(id);
      if (mod.createClient) {
        console.log('createClient from', id);
        return mod.createClient;
      }
    } catch {
      // continue
    }
    try {
      const mod = require(id);
      if (mod.createClient) {
        console.log('createClient require from', id);
        return mod.createClient;
      }
    } catch {
      // continue
    }
  }

  // scan filesystem
  const roots = ['/app', process.cwd(), '/home', '/opt'];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const walk = (dir, depth) => {
      if (depth > 5) return null;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return null;
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules' || ent.name === '@libsql') {
            const pkg = path.join(full, ent.name === '@libsql' ? 'client' : '@libsql/client');
            const pkgJson = path.join(pkg, 'package.json');
            if (fs.existsSync(pkgJson)) return pkg;
          }
          if (ent.name === 'node_modules' || !ent.name.startsWith('.')) {
            const found = walk(full, depth + 1);
            if (found) return found;
          }
        }
      }
      return null;
    };
    const found = walk(root, 0);
    if (found) {
      try {
        const mod = await import(found);
        if (mod.createClient) {
          console.log('createClient scanned from', found);
          return mod.createClient;
        }
      } catch (e) {
        console.log('scan import fail', found, e.message);
      }
    }
  }

  return null;
}

console.log('env TURSO_DATABASE_URL=', redact(process.env.TURSO_DATABASE_URL || ''));
console.log('env LIBSQL_URL=', redact(process.env.LIBSQL_URL || ''));
console.log('token_len=', token.length);

console.log(await get(http, `http://${host}:8080/v2`));
console.log(await get(https, `https://${host}:8080/v2`));

const createClient = await findCreateClient();
if (!createClient) {
  console.log('NO_LIBSQL_CLIENT');
  process.exit(0);
}

const urls = [
  process.env.TURSO_DATABASE_URL,
  process.env.LIBSQL_URL,
  `http://${host}:8080`,
  `http://libsql:${token}@${host}:8080`,
  `libsql://${host}:8080`,
].filter(Boolean);

for (const url of urls) {
  try {
    const client = createClient({ url, authToken: token });
    const rs = await client.execute('select 1 as ok');
    console.log('OK', redact(url), JSON.stringify(rs.rows));
    if (typeof client.close === 'function') client.close();
  } catch (err) {
    console.log('FAIL', redact(url), err?.message || String(err));
  }
}
