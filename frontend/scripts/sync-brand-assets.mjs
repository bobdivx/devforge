import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const devforgeRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceLogo = join(devforgeRoot, 'public', 'brand', 'logo.png');
const targetDir = join(devforgeRoot, '..', 'backend', 'public', 'brand');
const targetLogo = join(targetDir, 'logo.png');

if (!existsSync(sourceLogo)) {
    console.error(`Logo DevForge introuvable: ${sourceLogo}`);
    process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceLogo, targetLogo);
