# Guide: Générer Graft pour Toutes les Applications

## Vision

Avoir un graphe Graft dans chaque application permet à Cursor de naviguer ultra-rapidement dans n'importe quel repo de l'équipe avec :
- **-70% tokens** par recherche
- **3× plus rapide** qu'exploration manuelle
- **Navigation précise** file:line
- **Trace d'appels** automatique

## Pourquoi Pas un Script Automatique ?

Les repos sont **privés** sur GitHub. Options pour automatisation :
1. **SSH keys** — complexe à configurer pour CI/CD
2. **GitHub PAT** — risque sécurité si scripté
3. **Agent DevForge** — ✅ meilleure approche !

## Solution Recommandée: Agent Cursor par Repo

### Approche 1: Cursor Cloud Agent (Recommandé)

Pour chaque repo, lance un **Cursor Cloud Agent** avec cette instruction :

```
Ajoute Graft à ce repo :

1. Installe @nanonets/graft:
   npm install @nanonets/graft --save-dev

2. Génère le graphe:
   npx graft build --dir .graft
   (30-60s, indexe tout le code)

3. Crée .mcp.json:
   {
     "mcpServers": {
       "graft": {
         "command": "npx",
         "args": ["graft", "mcp", "--dir", ".graft"],
         "env": {}
       }
     }
   }

4. Ajoute .graft/ au .gitignore si pas déjà présent

5. Crée GRAFT.md avec:
   # Graft Context Graph
   
   Ce repo utilise Graft (NanoNets) pour navigation ultra-rapide.
   
   ## Outils MCP Disponibles
   - graft_find_code(query) — Recherche symboles
   - graft_trace_calls(symbol, direction, depth) — Trace appels
   - graft_file_api(file) — Signatures API
   - graft_repo_map() — Vue d'ensemble
   - graft_check_freshness() — Vérifier si à jour
   
   ## CLI
   npx graft ask "query" --dir .graft
   npx graft callers Symbol --dir .graft
   npx graft skeleton file.ts --dir .graft
   
   ## Régénérer
   npx graft build --dir .graft
   
   Voir devforge/GRAFT_INTEGRATION.md pour détails complets.

6. Commit et push:
   git add .gitignore .mcp.json GRAFT.md package.json package-lock.json
   git commit -m "feat: ajouter Graft context graph
   
   - Graphe .graft/ pour navigation IA
   - Serveur MCP configuré
   - 70% moins tokens, 3× plus rapide"
   
   git push origin main

Fais ça maintenant sur la branche main.
```

### Approche 2: Manuellement dans Cursor

Si tu préfères faire ça toi-même, dans chaque repo :

1. **Clone** le repo localement
2. **Ouvre** dans Cursor
3. **Execute** dans le terminal:
   ```bash
   npm install @nanonets/graft --save-dev
   npx graft build --dir .graft
   ```
4. **Crée** `.mcp.json` (copie de devforge)
5. **Ajoute** `.graft/` au `.gitignore`
6. **Crée** `GRAFT.md` (documentation)
7. **Commit** et **push**

## Applications à Traiter

| App | UUID | Statut |
|-----|------|--------|
| TeslaReports | `i133woyjn2xt3t460hkgcf40` | ⏳ À faire |
| aline-farm | `axatut4nxtv9yvegb9xfodot` | ⏳ À faire |
| eventlist | `ua29he73au14lhiclxkwxvb6` | ⏳ À faire |
| jeser | `iy8emmpxmyi356q3smyexbew` | ⏳ À faire |
| macompta | `t5dl8ku7r7wwtq190j274pbu` | ⏳ À faire |
| mf3d-filaments | `pr3pcdk6hl327eylvauh2iud` | ⏳ À faire |
| popcorn-client | `uji97r70f1jaq9m7l9btm61d` | ⏳ À faire |
| popcorn-web | `xuclselaiszdyfols1cqoe2t` | ⏳ À faire |
| sonozz | `kq5rr0s1qn0hkcs58gflvljk` | ⏳ À faire |
| starbasefr | `n1srcb613pwjq3k1x73fpw37` | ⏳ À faire |
| tesla | `jzj1197dymop7rht9apfwhv0` | ⏳ À faire |

**Total**: 11 applications

## Template .mcp.json

```json
{
  "mcpServers": {
    "graft": {
      "command": "npx",
      "args": ["graft", "mcp", "--dir", ".graft"],
      "env": {}
    }
  }
}
```

Si le repo a déjà d'autres serveurs MCP (Laravel Boost, etc.), **fusionne** au lieu de remplacer.

## Template GRAFT.md

Copie le contenu de `/workspace/GRAFT_INTEGRATION.md` section "Usage" ou crée un résumé court :

```markdown
# Graft Context Graph

Navigation ultra-rapide du codebase avec Graft (NanoNets).

## Avantages
- **-70% tokens** (50k → 15k par recherche)
- **3× plus rapide** que grep/search manuel
- **Traces d'appels** automatiques
- **API surface** sans bruit d'implémentation

## Utilisation dans Cursor

Outils MCP disponibles automatiquement :
- `graft_find_code("query")` — Recherche
- `graft_trace_calls("Symbol", "in"|"out", depth)` — Qui appelle quoi
- `graft_file_api("path/file.ts")` — Signatures publiques
- `graft_repo_map()` — Vue d'ensemble
- `graft_check_freshness()` — Vérifier fraîcheur

## CLI

```bash
npx graft ask "authentication" --dir .graft
npx graft callers UserController --dir .graft
npx graft skeleton src/models/User.ts --dir .graft
```

## Régénérer le graphe

Après gros changements :
```bash
npx graft build --dir .graft
```

Temps : 10-60s selon taille du codebase.

---

Voir [devforge/GRAFT_INTEGRATION.md](https://github.com/bobdivx/devforge/blob/main/GRAFT_INTEGRATION.md) pour documentation complète.
```

## Commande Complète Copy-Paste

Pour être super efficace, voici la **commande complète** à exécuter dans chaque repo :

```bash
# Dans chaque repo, exécute:
npm install @nanonets/graft --save-dev && \
npx graft build --dir .graft && \
echo '{"mcpServers":{"graft":{"command":"npx","args":["graft","mcp","--dir",".graft"],"env":{}}}}' > .mcp.json && \
echo -e "\n# graft's local graph cache — regenerable, not committed\n/.graft/" >> .gitignore && \
cat > GRAFT.md << 'EOF'
# Graft Context Graph

Navigation ultra-rapide avec Graft (NanoNets).

## Outils MCP
- graft_find_code(query)
- graft_trace_calls(symbol, direction, depth)
- graft_file_api(file)
- graft_repo_map()

## CLI
npx graft ask "query" --dir .graft
npx graft callers Symbol --dir .graft

## Régénérer
npx graft build --dir .graft
EOF
git add .gitignore .mcp.json GRAFT.md package.json package-lock.json && \
git commit -m "feat: ajouter Graft context graph

-70% tokens, 3× plus rapide pour navigation IA" && \
git push origin main
```

## Alternative: Agent DevForge Automation

Si tu veux **vraiment** automatiser via DevForge, tu pourrais créer un agent spécialisé "Graft Deployer" qui :

1. Liste toutes les apps (`list_applications`)
2. Pour chaque app :
   - Lit le code source via `list_application_source` + `read_application_source`
   - Génère localement le graphe Graft
   - Écrit les fichiers via `write_application_source`
   - Commit via `write_github_file` + `create_github_pull_request`

Mais c'est **beaucoup plus complexe** que de simplement lancer un Cursor Agent par repo.

## Recommandation Finale

🎯 **Utilise Cursor Cloud Agent** sur chaque repo avec la commande copy-paste ci-dessus.

Temps estimé : **2-3 minutes par repo** × 11 repos = **~30 minutes total**

Ou encore plus rapide : **lance 11 Cloud Agents en parallèle** ! 🚀

## Vérification

Après déploiement sur un repo, vérifie :
```bash
# Le graphe existe
ls .graft/

# MCP configuré
cat .mcp.json

# Gitignore OK
grep .graft .gitignore

# Documentation
cat GRAFT.md

# Test CLI
npx graft ask "main class" --dir .graft
```

## Maintenance

Les agents DevForge **Veille** et **Relanceur** peuvent maintenant rebuild automatiquement les graphes Graft quand ils détectent des changements importants dans les codebases.

Pour rebuild manuel :
```bash
npx graft build --dir .graft
```

---

**Résumé** : Pas de script automatique car repos privés. Utilise Cursor Cloud Agents (recommandé) ou commande bash manuelle pour chaque repo. 30 min total pour 11 apps. 🎉
