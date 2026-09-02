# Wiki : Configuration LLM Locale Haute Performance (Pinokio & DevForge)

Ce guide détaille la mise en place, l'optimisation maximale GPU (RTX 3090 24 Go) et l'intégration réseau de **Pinokio Uncensored Local Studio** avec les agents autonomes de **DevForge**.

---

## 1. Architecture Globale

```
+-------------------------------------------------------------------+
|                        Machine DevForge                           |
|  (Agent Runtime Rust Rig + Backend Laravel + Frontend React)      |
+---------------------------------+---------------------------------+
                                  |
                                  | HTTP / OpenAI-compatible API
                                  | POST http://10.1.0.88:10086/v1/chat/completions
                                  v
+-------------------------------------------------------------------+
|               Machine Hôte GPU (10.1.0.88 - RTX 3090 24 Go)       |
|                                                                   |
|   Pinokio Launcher (start.js)                                     |
|        │                                                          |
|        ▼                                                          |
|   Node.js Server (scripts/server/serve.cjs)                       |
|        │                                                          |
|        ├─ Pas de chargement auto (VRAM vide au démarrage)         |
|        │   → charger le modèle via DevForge (#pinokio)            |
|        │                                                          |
|        ▼                                                          |
|   llama-server.exe (CUDA 12 Backend)                              |
|        ├─ Host: 0.0.0.0:10086                                     |
|        ├─ Modèle: Qwen3-Coder-30B-A3B-Instruct (Q4_K_M)           |
|        ├─ Contexte: 65 536 tokens (64k)                           |
|        ├─ Offload: 100% VRAM (n-gpu-layers -1)                    |
|        └─ Flash Attention: on (KV cache q8_0)                     |
+-------------------------------------------------------------------+
```

---

## 2. Spécifications & Budget Mémoire (RTX 3090 - 24 Go)

Le modèle **Qwen3-Coder-30B-A3B-Instruct** utilise une architecture **MoE (Mixture of Experts)** :
- **Taille des poids (Q4_K_M)** : ~17.5 Go VRAM.
- **Paramètres actifs par token** : ~3.3B (vitesse de génération ultra-rapide ~60+ t/s).
- **KV Cache 64k (quantifié `q8_0`)** : ~5.6 Go VRAM.
- **Total VRAM occupée** : **~23.1 Go / 24.0 Go** $\rightarrow$ **100% en VRAM GPU sans aucun swapping RAM !**

| Paramètre | Valeur Recommandée | Rôle |
| :--- | :--- | :--- |
| **Hôte d'écoute** | `0.0.0.0` | Permet à DevForge et aux autres machines du réseau local d'accéder à l'API. |
| **Port LLM** | `10086` | Port standard de llama-server. |
| **Taille de contexte** | `65536` (64k) | Permet aux agents d'ingérer l'historique complet et les outils MCP sans overflow. |
| **Offload GPU** | `-1` (tous les layers) | 100% du modèle exécuté par la RTX 3090. |
| **Flash Attention** | `on` | Réduit l'empreinte mémoire du KV Cache et accélère le calcul d'attention. |
| **KV Cache K / V** | `q8_0` | Quantification 8-bit du cache mémoire (économie de 50% de VRAM avec 0% perte de précision). |
| **Batch Size** | `2048` | Vitesse maximale pour ingérer de gros prompts d'agents. |
| **Micro-batch (ubatch)** | `512` | Évite les saccades lors du traitement des tokens. |

---

## 3. Supprimer le lancement manuel de llama-server (cause fréquente)

Si vous aviez configuré un démarrage direct du type :

```text
D:\pinokio\api\uncensored-local-studio\app\app\llm-backend\win\cuda\llama-server.exe
  --model D:\pinokio\...\qwen3-coder-30b-a3b-instruct-q4_k_m.gguf
  --host 0.0.0.0 --port 10086 --ctx-size 8192 --n-gpu-layers 35
```

**c’est cette commande** qui recharge l’ancien modèle à chaque boot — pas seulement `serve.cjs`.

Sur Demeter (Linux) :

```bash
cd ~/Documents/devforge
bash scripts/demeter-bootstrap/stabilize-demeter.sh
bash scripts/demeter-bootstrap/patch-serve-llm-host.sh
```

Scripts Windows legacy (ancienne install) : `scripts/demeter-bootstrap/legacy-windows/pinokio-demeter-reset-llm.ps1`

Le script :
- tue `llama-server` sur le port `10086`
- supprime l’auto-load dans `serve.cjs`
- cherche et nettoie les fichiers Pinokio qui lancent `llama-server.exe --model ...`

Ensuite **ne relancez plus** `llama-server.exe` à la main. Utilisez **Start** dans Pinokio (→ `serve.cjs` uniquement).

---

## 4. Désactiver l’auto-load injecté dans serve.cjs

L’ancienne config chargeait automatiquement le **premier fichier « qwen »** trouvé (souvent `qwen3-coder-30b-a3b-instruct-q4_k_m.gguf`). Après avoir téléchargé un **nouveau** GGUF, désactivez cet auto-load pour éviter de remonter l’ancien modèle au démarrage de Pinokio.

Sur la machine GPU (Demeter), en bash :

```bash
cd ~/Documents/devforge
bash scripts/demeter-bootstrap/setup-demeter-boot.sh
```

Script Windows legacy : `scripts/demeter-bootstrap/legacy-windows/pinokio-serve-disable-autoload.ps1`

Chemin par défaut de `serve.cjs` : `D:\pinokio\api\uncensored-local-studio\app\scripts\server\serve.cjs`

Puis **redémarrez** Pinokio Uncensored Local Studio. Le serveur écoute sur `:10086` **sans modèle en VRAM** — chargez le bon fichier dans **DevForge → Paramètres AI → Demeter / Pinokio → Charger sur GPU**.

### Auto-load optionnel (un seul modèle précis)

Si vous voulez quand même un démarrage automatique, **nommez explicitement** le fichier GGUF (pas de recherche « qwen ») :

```powershell
.\scripts\pinokio-serve-configure-autoload.ps1 -ModelFilename "VOTRE-MODELE.gguf"
```

---

## 5. Optimisations réseau / contexte (serve.cjs)

Pour appliquer host `0.0.0.0`, contexte 64k et Jinja (tool calls), sur la machine hôte :

```powershell
$path = "D:\pinokio\api\uncensored-local-studio\app\scripts\server\serve.cjs"
$content = (Get-Content -Path $path -Raw)

$content = $content `
  -replace '"--host", "127\.0\.0\.1"', '"--host", "0.0.0.0"' `
  -replace 'Math\.min\(32768, contextSize\)', 'Math.min(65536, contextSize)' `
  -replace '16384 : 32768;', '16384 : 65536;' `
  -replace '\[32768, 24576,', '[65536, 32768, 24576,' `
  -replace '"--parallel", "1",', '"--parallel", "1", "--jinja",'

Set-Content -Path $path -Value $content.TrimEnd() -Encoding UTF8
Write-Host "✅ Optimisations serve.cjs appliquées (sans auto-load)." -ForegroundColor Green
```

---

## 6. Configuration dans l'interface DevForge

Dans DevForge, pour configurer l'agent afin qu'il utilise votre serveur local :

1. Allez dans **Paramètres AI → Demeter / Pinokio** (`#pinokio`).
2. Vérifiez l’URL : `http://10.1.0.88:10086`
3. **Tester** puis **Charger sur GPU** le GGUF téléchargé.
4. Pour les agents, le provider OpenAI local peut rester dans **Providers & clés** :
   - **Base URL** : `http://10.1.0.88:10086/v1`
   - **Model Name** : nom exact du GGUF chargé (ou `auto`)

---

## 7. Contrôle & Monitoring Direct depuis DevForge

DevForge intègre désormais un **panneau de gestion en temps réel** pour votre instance Pinokio :

1. **Monitoring GPU & VRAM** :
   - Jauge en direct de la mémoire VRAM occupée sur votre RTX 3090 (ex: `23.1 / 24.0 Go`).
   - Statut du serveur et mode backend (`CUDA GPU`).
2. **Permutation de modèles GGUF en 1 clic** :
   - Liste de tous les fichiers `.gguf` présents dans `app/llm-models/`.
   - Bouton **« Charger sur GPU »** : déclenche le swap à distance avec 64k tokens, Flash Attention et GPU offloading complet.
3. **Mise en veille GPU** :
   - Bouton **« Mettre en veille (Libérer VRAM) »** pour décharger le modèle et libérer les 24 Go de VRAM quand vous ne travaillez pas avec les agents.
4. **Accès** :
   - **Paramètres AI → Demeter / Pinokio** (`#pinokio`)

---

## 8. Résolution des Problèmes Fréquents (Troubleshooting)

### L’ancien qwen3-coder revient toujours au démarrage

- **Cause** : tâche planifiée, raccourci, ou script `.bat` qui lance `llama-server.exe --model ...qwen3-coder...` avant Pinokio.
- **Solution** : `pinokio-demeter-reset-llm.ps1`, puis vérifier le Planificateur de tâches Windows et les raccourcis Démarrage pour `llama-server`.

### Erreur : `request (XXXX tokens) exceeds the available context size`
- **Cause** : Le contexte alloué au démarrage de llama-server était inférieur à la taille de la requête.
- **Solution** : Vérifiez que `serve.cjs` démarre bien avec `--ctx-size 65536`.

### Erreur : `LLM error from 10.1.0.88:10086: CompletionError: JsonError`
- **Cause** : Le modèle n'était pas encore chargé en mémoire VRAM au moment où la requête est arrivée, ou le port était inaccessible.
- **Solution** : Désactivez l’auto-load (`pinokio-serve-disable-autoload.ps1`), redémarrez Pinokio, chargez le modèle via DevForge (#pinokio), attendez « Actif en VRAM ».

### Erreur : `unknown value for --flash-attn: --cache-type-k`
- **Cause** : Les versions récentes de llama-server attendent `--flash-attn on` et non `--flash-attn` seul.
- **Solution** : C'est géré automatiquement dans `serve.cjs` avec `args.push("--flash-attn", "on")`.

### Erreur : `LLM timeout after 60s contacting 10.1.0.88:10086`
- **Cause** : L'ingestion d'un gros prompt d'agent (~20 000 tokens) a pris plus de 60 secondes car le `batch-size` était réglé trop bas (512).
- **Solution** : 
  1. Utilisez `batchSize: 2048` dans `serve.cjs` (l'ingestion des 20k tokens passe de 65s à ~10s sur RTX 3090).
  2. Le timeout côté DevForge a été augmenté à **300 secondes (5 minutes)** par défaut (configurable via `DEVFORGE_AGENT_TIMEOUT=300` et `LLM_TIMEOUT_SECS=300`).

---

## 9. LiteLLM pour Cursor Agent (démarrage via Pinokio)

LiteLLM n’est **pas** inclus dans Uncensored Local Studio. C’est un proxy séparé (port **4000**) entre le tunnel Cloudflare et `llama-server` (:10086).

### Pourquoi Pinokio ?

Sans Pinokio, tu lances manuellement :

```powershell
litellm --config D:\pinokio\litellm-config.yaml --port 4000
```

→ **Après chaque reboot**, il faut relancer cette commande.

Avec l’app Pinokio **LiteLLM Cursor Proxy**, LiteLLM redémarre **automatiquement** quand Pinokio démarre (`PINOKIO_SCRIPT_AUTOLAUNCH`).

### Installation (une fois, sur Demeter)

```powershell
cd C:\Users\auber\Documents\GitHub\devforge
.\scripts\pinokio-litellm-install.ps1
```

Puis dans **Pinokio** :

1. Ouvrir l’app **LiteLLM Cursor Proxy** (`D:\pinokio\api\litellm-cursor-proxy`)
2. **Install** (installe LiteLLM ≥ 1.97 dans un venv isolé)
3. **Start**

Vérification :

```powershell
curl.exe http://127.0.0.1:4000/health/liveliness
```

### Auto-start après reboot Windows

| Composant | Comment |
|-----------|---------|
| **Pinokio** | Paramètres Pinokio → **Launch at startup** (démarrage Windows) |
| **LiteLLM** | `PINOKIO_SCRIPT_AUTOLAUNCH=start.js` (écrit par le script d’install) |
| **llama-server** | App **Uncensored Local Studio** dans Pinokio (Start ou autolaunch séparé) |
| **Tunnel Cloudflare** | Service Windows / tâche planifiée séparée (`agent.briseteia.me`) |

### Config Cursor (inchangée)

| Réglage | Valeur |
|---------|--------|
| Base URL | `https://agent.briseteia.me/v1` |
| Modèle | `demeter-qwen3-coder` |
| API Key | `master_key` du YAML (`/mnt/ia/pinokio/litellm-config.yaml`) |

Fichiers : `scripts/pinokio-litellm-cursor-proxy/`, `scripts/demeter-bootstrap/litellm-config.demeter.yaml`
Installation Windows legacy : `scripts/demeter-bootstrap/legacy-windows/pinokio-litellm-install.ps1`

### Sauvegarde avant migration OS (CatchyOS, etc.)

Script : `scripts/demeter-bootstrap/legacy-windows/pinokio-backup-demeter.ps1` (Windows legacy)

```powershell
cd C:\Users\auber\Documents\scripts
powershell -ExecutionPolicy Bypass -File .\pinokio-backup-demeter.ps1
```

Sauvegarde legere (configs + apps, sans GGUF) : quelques GB max.

Avec les modeles GGUF (~17 GB+) :

```powershell
powershell -ExecutionPolicy Bypass -File .\pinokio-backup-demeter.ps1 -IncludeModels
```

Contenu typique : `api\` (apps Pinokio, `serve.cjs` patche, ENVIRONMENT), `litellm-config.yaml`. Exclut par defaut `node_modules`, `venv`, `llm-models`.


