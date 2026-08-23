#!/usr/bin/env node

/**
 * Graft Generator via DevForge MCP Tools
 * 
 * Génère des graphes Graft directement via les outils MCP DevForge
 * sans besoin de cloner les repos (accès via GitHub App).
 * 
 * Usage:
 *   node scripts/graft-via-mcp.mjs [--app=<name>] [--dry-run]
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';

const APPS = [
  { name: 'TeslaReports', uuid: 'i133woyjn2xt3t460hkgcf40' },
  { name: 'aline-farm', uuid: 'axatut4nxtv9yvegb9xfodot' },
  { name: 'eventlist', uuid: 'ua29he73au14lhiclxkwxvb6' },
  { name: 'macompta', uuid: 't5dl8ku7r7wwtq190j274pbu' },
  { name: 'mf3d-filaments', uuid: 'pr3pcdk6hl327eylvauh2iud' },
  { name: 'popcorn-client', uuid: 'uji97r70f1jaq9m7l9btm61d' },
  { name: 'popcorn-web', uuid: 'xuclselaiszdyfols1cqoe2t' },
  { name: 'sonozz', uuid: 'kq5rr0s1qn0hkcs58gflvljk' },
  { name: 'starbasefr', uuid: 'n1srcb613pwjq3k1x73fpw37' },
  { name: 'tesla', uuid: 'jzj1197dymop7rht9apfwhv0' },
];

const WORK_DIR = '/tmp/graft-via-mcp';
const DRY_RUN = process.argv.includes('--dry-run');
const FILTER_APP = process.argv.find(arg => arg.startsWith('--app='))?.split('=')[1];

const MCP_JSON_CONTENT = JSON.stringify({
  mcpServers: {
    graft: {
      command: 'npx',
      args: ['graft', 'mcp', '--dir', '.graft'],
      env: {},
    },
  },
}, null, 2) + '\n';

const GITIGNORE_GRAFT = '\n# Graft context graph (regenerable)\n/.graft/\n';

const GRAFT_README = `# Graft Context Graph

Navigation ultra-rapide du codebase avec Graft (NanoNets).

## Outils MCP Disponibles

Dans Cursor, ces outils sont automatiquement disponibles :

- \`graft_find_code(query)\` — Recherche symboles/concepts
- \`graft_trace_calls(symbol, direction, depth)\` — Trace appels (in/out)
- \`graft_file_api(file)\` — Signatures API sans implémentation
- \`graft_repo_map()\` — Vue d'ensemble architecture
- \`graft_check_freshness()\` — Vérifier si graphe à jour

## Avantages

- **-70% tokens** par recherche (50k → 15k)
- **3× plus rapide** que recherche manuelle
- **Précision file:line** exacte
- **Trace d'appels** automatique

## CLI Alternative

\`\`\`bash
npx graft ask "authentication" --dir .graft
npx graft callers UserController --dir .graft
npx graft skeleton src/file.ts --dir .graft
\`\`\`

## Régénérer

Après gros changements :

\`\`\`bash
npx graft build --dir .graft
\`\`\`

Temps : 10-60s selon taille.

---

Voir [devforge/GRAFT_INTEGRATION.md](https://github.com/bobdivx/devforge/blob/main/GRAFT_INTEGRATION.md) pour documentation complète.
`;

function exec(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', ...options });
  } catch (error) {
    return null;
  }
}

function log(emoji, message) {
  console.log(`${emoji} ${message}`);
}

async function processApp(app) {
  const { name, uuid } = app;
  const workPath = join(WORK_DIR, name);
  
  log('🚀', `\n========== ${name} ==========`);
  
  // Créer dossier de travail propre
  if (existsSync(workPath)) {
    rmSync(workPath, { recursive: true, force: true });
  }
  mkdirSync(workPath, { recursive: true });
  
  log('📋', `UUID: ${uuid}`);
  
  // Note: Les outils MCP DevForge ne permettent pas de lire/écrire directement
  // les fichiers sources des apps. On ne peut que lire via list_application_source.
  // Pour un vrai déploiement, il faudrait :
  // 1. Lire tous les fichiers via list_application_source + read_application_source
  // 2. Les écrire localement
  // 3. Générer Graft
  // 4. Commit via write_github_file + create_github_pull_request
  
  log('⚠️', 'Cette app nécessite accès GitHub direct (SSH/PAT)');
  log('💡', 'Recommandation: Utilise Cursor Cloud Agent sur ce repo');
  log('💡', 'Ou clone manuellement et exécute:');
  log('💡', '  npm i @nanonets/graft --save-dev');
  log('💡', '  npx graft build --dir .graft');
  log('💡', '  # Ajoute .mcp.json et GRAFT.md');
  log('💡', '  git commit & push');
  
  return { name, uuid, status: 'manual_required' };
}

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Graft Generator via MCP                      ║');
  console.log('║   DevForge Automation                          ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  log('ℹ️', 'Les outils MCP DevForge ne permettent pas l\'écriture directe');
  log('ℹ️', 'Alternative recommandée: Cursor Cloud Agents');
  console.log('');

  if (DRY_RUN) {
    log('🔍', 'MODE DRY-RUN activé');
  }

  let appsToProcess = APPS;
  
  if (FILTER_APP) {
    appsToProcess = APPS.filter(app => app.name === FILTER_APP);
    if (appsToProcess.length === 0) {
      console.error(`❌ App "${FILTER_APP}" introuvable`);
      process.exit(1);
    }
    log('🎯', `Traitement: ${FILTER_APP}`);
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
      results.push({ name: app.name, status: 'error', error: error.message });
    }
  }

  // Résumé avec instructions
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║   RECOMMANDATION: CURSOR CLOUD AGENTS          ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  log('🎯', 'Lance un Cursor Cloud Agent par repo avec:');
  console.log('');
  console.log('─────────────────────────────────────────────────');
  console.log('Ajoute Graft sur main:');
  console.log('');
  console.log('npm install @nanonets/graft --save-dev');
  console.log('npx graft build --dir .graft');
  console.log('');
  console.log('Crée .mcp.json:');
  console.log(MCP_JSON_CONTENT);
  console.log('');
  console.log('Ajoute au .gitignore:');
  console.log('/.graft/');
  console.log('');
  console.log('Crée GRAFT.md avec doc rapide');
  console.log('');
  console.log('Commit et push sur main');
  console.log('─────────────────────────────────────────────────');
  console.log('');

  log('📋', 'Applications:');
  results.forEach(r => {
    console.log(`   ${r.status === 'manual_required' ? '⏳' : '❌'} ${r.name} (${r.uuid})`);
  });

  console.log('');
  log('💡', 'Astuce: Lance 10 Cloud Agents en parallèle!');
  log('⏱️', 'Temps estimé: 3-5 min total (vs 30 min séquentiel)');
  console.log('');
  log('🎉', 'Ou utilise la commande bash dans chaque repo localement');
}

main().catch(error => {
  console.error('\n❌ Erreur fatale:');
  console.error(error);
  process.exit(1);
});
