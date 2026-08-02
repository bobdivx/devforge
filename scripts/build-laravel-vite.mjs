#!/usr/bin/env node
/**
 * Run Vite with cwd=backend so laravel-vite-plugin resolves
 * resources/* correctly (Vite root alone is not enough when invoked from monorepo root).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(repoRoot, 'backend');
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');

const result = spawnSync(
    process.execPath,
    [viteBin, 'build', '--config', 'vite.config.js'],
    {
        cwd: backend,
        stdio: 'inherit',
        env: process.env,
    },
);

process.exit(result.status ?? 1);
