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
|        ├─ Auto-load Qwen3 au démarrage                            |
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

## 3. Mise à jour Automatique en 1 Clic (PowerShell)

Pour appliquer toutes ces optimisations et activer le **chargement automatique du modèle au démarrage** de Pinokio, ouvrez PowerShell sur la machine hôte (`D:`) et collez la commande suivante :

```powershell
# 1. Nettoyer toute ancienne tentative auto-load
$path = "D:\pinokio\api\uncensored-local-studio\app\scripts\server\serve.cjs"
$content = (Get-Content -Path $path -Raw)
$content = $content -replace "(?s)// Auto-load LLM model on server startup.*", ""

# 2. Remplacer les verrous de contexte et d'écoute réseau + activer Jinja pour les tool calls
$content = $content `
  -replace '"--host", "127\.0\.0\.1"', '"--host", "0.0.0.0"' `
  -replace 'Math\.min\(32768, contextSize\)', 'Math.min(65536, contextSize)' `
  -replace '16384 : 32768;', '16384 : 65536;' `
  -replace '\[32768, 24576,', '[65536, 32768, 24576,' `
  -replace '"--parallel", "1",', '"--parallel", "1", "--jinja",'

# 3. Injecter l'auto-load au démarrage avec 65536 tokens et Flash Attention
$autoLoadCode = @'

// Auto-load LLM model on server startup
setTimeout(async () => {
  try {
    const models = typeof getLlmModels === "function" ? getLlmModels() : [];
    const target = models.find(m => !m.isProjector && m.filename.toLowerCase().includes("qwen")) || models.find(m => !m.isProjector);
    if (target) {
      console.log("  [llm] Auto-loading model " + target.filename + " with 65536 context...");
      await startLlm({
        model: target.filename,
        contextSize: 65536,
        gpuLayers: -1,
        flashAttn: true,
        cacheTypeK: "q8_0",
        cacheTypeV: "q8_0",
        batchSize: 2048,
        ubatchSize: 512
      });
      console.log("  [llm] Model " + target.filename + " is READY in VRAM (65k context)!");
    }
  } catch (e) {
    console.warn("  [llm] Auto-start failed:", e.message);
  }
}, 2000);
'@

Set-Content -Path $path -Value ($content.TrimEnd() + "`r`n" + $autoLoadCode) -Encoding UTF8
Write-Host "✅ Configuration serve.cjs mise à jour avec succès !" -ForegroundColor Green
```

---

## 4. Configuration dans l'interface DevForge

Dans DevForge, pour configurer l'agent afin qu'il utilise votre serveur local :

1. Allez dans **Settings** $\rightarrow$ **AI / LLM Providers**.
2. Ajoutez ou éditez un provider :
   - **Provider Type** : `OpenAI-compatible` (ou `Local`)
   - **Base URL** : `http://10.1.0.88:10086/v1`
   - **API Key** : `sk-local-devforge` (ou n'importe quelle valeur non vide)
   - **Model Name** : `qwen3-coder-30b-a3b-instruct-q4_k_m.gguf`
   - **Context Limit** : `65536`

---

## 5. Contrôle & Monitoring Direct depuis DevForge (Nouveau !)

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
   - Rendez-vous dans **Settings** $\rightarrow$ **AI / LLM Providers** pour visualiser et contrôler Pinokio directement !

---

## 6. Résolution des Problèmes Fréquents (Troubleshooting)

### Erreur : `request (XXXX tokens) exceeds the available context size`
- **Cause** : Le contexte alloué au démarrage de llama-server était inférieur à la taille de la requête.
- **Solution** : Vérifiez que `serve.cjs` démarre bien avec `--ctx-size 65536`.

### Erreur : `LLM error from 10.1.0.88:10086: CompletionError: JsonError`
- **Cause** : Le modèle n'était pas encore chargé en mémoire VRAM au moment où la requête est arrivée, ou le port était inaccessible.
- **Solution** : Avec le script d'auto-load ci-dessus, attendez 10 à 15 secondes après le clic sur **Start** dans Pinokio pour que le modèle soit chargé en VRAM.

### Erreur : `unknown value for --flash-attn: --cache-type-k`
- **Cause** : Les versions récentes de llama-server attendent `--flash-attn on` et non `--flash-attn` seul.
- **Solution** : C'est géré automatiquement dans `serve.cjs` avec `args.push("--flash-attn", "on")`.

### Erreur : `LLM timeout after 60s contacting 10.1.0.88:10086`
- **Cause** : L'ingestion d'un gros prompt d'agent (~20 000 tokens) a pris plus de 60 secondes car le `batch-size` était réglé trop bas (512).
- **Solution** : 
  1. Utilisez `batchSize: 2048` dans `serve.cjs` (l'ingestion des 20k tokens passe de 65s à ~10s sur RTX 3090).
  2. Le timeout côté DevForge a été augmenté à **300 secondes (5 minutes)** par défaut (configurable via `DEVFORGE_AGENT_TIMEOUT=300` et `LLM_TIMEOUT_SECS=300`).


