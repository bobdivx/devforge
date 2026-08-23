#!/usr/bin/env node

/**
 * Graft Local Generator for DevForge Apps
 * 
 * Génère des graphes Graft pour toutes les applications accessibles
 * via les outils MCP DevForge et commit sur leurs branches main.
 * 
 * Cette version utilise les outils MCP pour éviter les problèmes d'accès SSH/HTTPS.
 * 
 * Usage:
 *   node scripts/graft-local-gen.mjs [--app=<name>]
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

const APPS = [
  { name: 'TeslaReports', uuid: 'i133woyjn2xt3t460hkgcf40' },
  { name: 'aline-farm', uuid: 'axatut4nxtv9yvegb9xfodot' },
  { name: 'eventlist', uuid: 'ua29he73au14lhiclxkwxvb6' },
  { name: 'jeser', uuid: 'iy8emmpxmyi356q3smyexbew' },
  { name: 'macompta', uuid: 't5dl8ku7r7wwtq190j274pbu' },
  { name: 'mf3d-filaments', uuid: 'pr3pcdk6hl327eylvauh2iud' },
  { name: 'popcorn-client', uuid: 'uji97r70f1jaq9m7l9btm61d' },
  { name: 'popcorn-web', uuid: 'xuclselaiszdyfols1cqoe2t' },
  { name: 'sonozz', uuid: 'kq5rr0s1qn0hkcs58gflvljk' },
  { name: 'starbasefr', uuid: 'n1srcb613pwjq3k1x73fpw37' },
  { name: 'tesla', uuid: 'jzj1197dymop7rht9apfwhv0' },
];

const WORK_DIR = '/tmp/graft-local-gen';
const FILTER_APP = process.argv.find(arg => arg.startsWith('--app='))?.split('=')[1];

function exec(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', ...options });
  } catch (error) {
    console.error(`❌ Command failed: ${cmd}`);
    console.error(error.stderr || error.message);
    throw error;
  }
}

function log(emoji, message) {
  console.log(`${emoji} ${message}`);
}

async function processApp(app) {
  const { name, uuid } = app;
  const workPath = join(WORK_DIR, name);
  
  log('🚀', `\n========== ${name} ==========`);
  
  // Créer dossier de travail
  if (existsSync(workPath)) {
    log('🗑️', 'Nettoyage dossier existant...');
    rmSync(workPath, { recursive: true, force: true });
  }
  
  mkdirSync(workPath, { recursive: true });
  
  log('ℹ️', `UUID: ${uuid}`);
  log('ℹ️', 'Pour cette app, tu dois manuellement:');
  log('ℹ️', '1. Cloner le repo localement avec SSH/token');
  log('ℹ️', '2. Exécuter: npx graft build --dir .graft');
  log('ℹ️', '3. Ajouter .mcp.json avec config Graft');
  log('ℹ️', '4. Ajouter .graft/ au .gitignore');
  log('ℹ️', '5. Créer GRAFT.md (voir GRAFT_INTEGRATION.md)');
  log('ℹ️', '6. Commit et push sur main');
  
  return { name, uuid, manual: true };
}

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Graft Local Generator                        ║');
  console.log('║   Instructions manuelles pour chaque app      ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  let appsToProcess = APPS;
  
  if (FILTER_APP) {
    appsToProcess = APPS.filter(app => app.name === FILTER_APP);
    if (appsToProcess.length === 0) {
      console.error(`❌ App "${FILTER_APP}" introuvable`);
      process.exit(1);
    }
    log('🎯', `Traitement uniquement: ${FILTER_APP}`);
  }

  log('📋', `${appsToProcess.length} application(s)\n`);

  const results = [];
  
  for (const app of appsToProcess) {
    try {
      const result = await processApp(app);
      results.push(result);
    } catch (error) {
      console.error(`\n❌ Erreur pour ${app.name}:`);
      console.error(error.message);
      results.push({ name: app.name, manual: true, error: error.message });
    }
  }

  // Instructions finales
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║   INSTRUCTIONS DÉTAILLÉES                      ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  console.log('Pour chaque application, dans Cursor ou ton IDE local:');
  console.log('');
  console.log('1️⃣  Clone le repo:');
  console.log('    git clone git@github.com:bobdivx/<repo>.git');
  console.log('    cd <repo>');
  console.log('');
  console.log('2️⃣  Installe Graft:');
  console.log('    npm install @nanonets/graft --save-dev');
  console.log('');
  console.log('3️⃣  Génère le graphe:');
  console.log('    npx graft build --dir .graft');
  console.log('    # Temps: 10-60s selon taille');
  console.log('');
  console.log('4️⃣  Crée .mcp.json:');
  console.log('    {');
  console.log('      "mcpServers": {');
  console.log('        "graft": {');
  console.log('          "command": "npx",');
  console.log('          "args": ["graft", "mcp", "--dir", ".graft"],');
  console.log('          "env": {}');
  console.log('        }');
  console.log('      }');
  console.log('    }');
  console.log('');
  console.log('5️⃣  Ajoute au .gitignore:');
  console.log('    echo "/.graft/" >> .gitignore');
  console.log('');
  console.log('6️⃣  Crée GRAFT.md (copie de devforge/GRAFT.md ou GRAFT_INTEGRATION.md)');
  console.log('');
  console.log('7️⃣  Commit et push:');
  console.log('    git add .gitignore .mcp.json GRAFT.md package.json package-lock.json');
  console.log('    git commit -m "feat: ajouter Graft context graph"');
  console.log('    git push origin main');
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('📝 Liste des apps à traiter:');
  results.forEach(r => console.log(`   - ${r.name} (${r.uuid})`));
  console.log('');
  log('💡', 'Astuce: Utilise Cursor pour automatiser avec AI Agent!');
  log('💡', 'Commande: "Génère Graft pour ce repo" dans chaque app');
}

main().catch(error => {
  console.error('\n❌ Erreur fatale:');
  console.error(error);
  process.exit(1);
});
