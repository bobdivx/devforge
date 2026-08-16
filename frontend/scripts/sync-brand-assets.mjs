import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const backendPublic = join(frontendRoot, '..', 'backend', 'public');
const sourceLogo = join(frontendRoot, 'public', 'brand', 'logo.png');
const targetLogo = join(backendPublic, 'brand', 'logo.png');
const frontendFavicon = join(frontendRoot, 'public', 'favicon.ico');
const backendFavicon = join(backendPublic, 'favicon.ico');

if (!existsSync(sourceLogo)) {
    console.error(`Logo DevForge introuvable: ${sourceLogo}`);
    process.exit(1);
}

mkdirSync(join(backendPublic, 'brand'), { recursive: true });
cpSync(sourceLogo, targetLogo);
// Chrome demande toujours /favicon.ico, même si le HTML pointe vers un PNG.
cpSync(sourceLogo, frontendFavicon);
cpSync(sourceLogo, backendFavicon);
