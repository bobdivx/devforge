import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire('/app/package.json');
const { createClient } = require('@libsql/client');

const host = 'btnfrll4ubmua4nvk73y4h6u';
const token = process.env.TURSO_AUTH_TOKEN || '';
const user = 'libsql';

function redact(url) {
  return String(url).replace(/:[^:@/]+@/, ':***@');
}

async function tryClient(label, opts) {
  try {
    const client = createClient(opts);
    const rs = await client.execute('select 1 as ok');
    console.log('OK', label, redact(opts.url), JSON.stringify(rs.rows));
    if (typeof client.close === 'function') client.close();
  } catch (err) {
    console.log('FAIL', label, redact(opts.url), err?.message || String(err));
  }
}

async function tryFetch(label, url, headers = {}) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        requests: [{ type: 'execute', stmt: { sql: 'select 1 as ok' } }, { type: 'close' }],
      }),
    });
    const text = await res.text();
    console.log('FETCH', label, res.status, text.slice(0, 220));
  } catch (err) {
    console.log('FETCH', label, 'ERR', err.message);
  }
}

const basic = Buffer.from(`${user}:${token}`).toString('base64');

await tryClient('http+authToken', { url: `http://${host}:8080`, authToken: token });
await tryClient('http+noAuth', { url: `http://${host}:8080` });

await tryFetch('bearer', `http://${host}:8080/v2/pipeline`, { Authorization: `Bearer ${token}` });
await tryFetch('basic', `http://${host}:8080/v2/pipeline`, { Authorization: `Basic ${basic}` });
await tryFetch('none', `http://${host}:8080/v2/pipeline`);

// Custom fetch that injects Basic auth — pattern apps can use
await tryClient('http+customFetchBasic', {
  url: `http://${host}:8080`,
  fetch: async (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Basic ${basic}`);
    return fetch(input, { ...init, headers });
  },
});

console.log('cwd', process.cwd());
console.log('import.meta', pathToFileURL('/app/node_modules/@libsql/client').href);
