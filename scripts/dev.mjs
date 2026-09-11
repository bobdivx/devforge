#!/usr/bin/env node
/**
 * npm run dev — Astro (8080) + Rust server avec cargo-watch (8000).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(join(root, '.env'));
loadEnvFile(join(root, 'apps', 'server', '.env'));

if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'sqlite:devforge.db?mode=rwc';
if (!process.env.HOST) process.env.HOST = '0.0.0.0';
if (!process.env.PORT) process.env.PORT = '8000';

function quote(arg) {
  if (/^[a-zA-Z0-9_./:@%=,+-]+$/.test(arg)) return arg;
  if (isWin) return `"${arg.replace(/"/g, '\\"')}"`;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

const children = [];

/**
 * Une seule string + shell:true (Windows npm.cmd / PATH).
 * Évite spawn EINVAL (Node 24) et DEP0190 (args[] + shell).
 */
function run(label, command, args, color) {
  const cmdline = [command, ...args].map(quote).join(' ');
  const child = spawn(cmdline, {
    cwd: root,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
    windowsHide: true,
  });
  children.push(child);

  const prefix = (stream) => {
    stream.setEncoding('utf8');
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length) process.stdout.write(`${color}[${label}]\x1b[0m ${line}\n`);
      }
    });
  };
  prefix(child.stdout);
  prefix(child.stderr);

  child.on('error', (err) => {
    console.error(`[dev] ${label} spawn failed: ${err.message}`);
    if (!shuttingDown) shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[dev] ${label} stopped (code=${code ?? signal})`);
    shutdown(code ?? 1);
  });
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      if (isWin && c.pid) {
        spawn(`taskkill /pid ${c.pid} /T /F`, {
          stdio: 'ignore',
          shell: true,
          windowsHide: true,
        });
      } else {
        c.kill('SIGTERM');
      }
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(code), 300).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] web → http://127.0.0.1:8080  ·  api → http://127.0.0.1:8000');
run(
  'server',
  'cargo',
  [
    'watch',
    '-q',
    '-c',
    '-w',
    'apps/server',
    '-w',
    'crates',
    '-x',
    'run -p devforge-server',
  ],
  '\x1b[36m',
);
run('web', 'npm', ['run', 'dev', '-w', 'apps/web'], '\x1b[35m');
