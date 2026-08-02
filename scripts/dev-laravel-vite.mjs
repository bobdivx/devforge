#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(repoRoot, 'backend');
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');

const result = spawnSync(
    process.execPath,
    [viteBin, '--config', 'vite.config.js', ...process.argv.slice(2)],
    {
        cwd: backend,
        stdio: 'inherit',
        env: process.env,
    },
);

process.exit(result.status ?? 1);
