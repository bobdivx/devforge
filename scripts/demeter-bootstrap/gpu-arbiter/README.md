# Demeter GPU Arbiter — time-sharing LLM + ACE (+ priorité Steam)

> **Source of truth** : [`scripts/pinokio-gpu-arbiter/`](../../pinokio-gpu-arbiter/)  
> App Pinokio + UI Astro. Ce dossier reste le point d’entrée **systemd / CLI** Demeter.

## Runtime Demeter

Code + UI : **`/mnt/ia/pinokio/api/gpu-arbiter/`** (app Pinokio).  
Démarrage auto : systemd user → ce chemin (pas le vieux path bootstrap).

```bash
bash scripts/demeter-bootstrap/gpu-arbiter/switch-to-pinokio-runtime.sh
# ou
bash scripts/demeter-bootstrap/gpu-arbiter/sync-from-pinokio-package.sh
bash scripts/demeter-bootstrap/gpu-arbiter/install-gpu-arbiter.sh
```

Dashboard : `http://10.1.0.88:8790/` (UI) · API `GET /status`

## Problème

RTX 3090 = **24 Go**.  
Qwen3-Coder Q4 ctx 49k–65k ≈ **20–22 Go**. ACE XL ≈ **10 Go**.  
→ **impossible** de les garder chargés ensemble.

## Solution

Un **arbitre** sur le port **8790** :
- **1 slot GPU actif** : `llm` | `ace` | `wan`
- **Swap** : activer ACE → stoppe le LLM ; activer LLM → stoppe ACE
- **File d’attente** si un autre client tient le slot
- **Idle 15 min** → revient au slot par défaut (`llm`)
- **UI web** Astro (même port)

## API

```bash
curl -s http://10.1.0.88:8790/status | jq

curl -s -X POST http://10.1.0.88:8790/acquire \
  -H 'Content-Type: application/json' \
  -d '{"slot":"ace","owner":"homarr","timeout_s":600}'
```

## CLI

```bash
demeter-gpu status
demeter-gpu use ace
demeter-gpu use llm
demeter-gpu release
```

## Priorité Steam

Si un jeu Steam/Proton utilise le GPU → slot `steam`, acquire IA = `steam_priority`.  
Vars : `GPU_ARBITER_STEAM_PRIORITY`, `GPU_ARBITER_STEAM_POLL_S`, …

## LiteLLM / Cursor

Voir `install-litellm-gpu-proxy.sh` — proxy `:4000` → acquire `llm` auto.

## Pinokio

Après install, app disponible sous `/mnt/ia/pinokio/api/gpu-arbiter/` (Install / Start dans Pinokio).
