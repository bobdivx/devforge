# QLoRA Relanceur

Le **NAS / ZimaOS n'a pas de GPU**. Ce dossier n'est **pas** un service du compose NAS.
On entraîne sur l'hôte **Windows ou Linux GPU** qui sert déjà Ollama, puis le nouveau
modèle `devforge-relanceur` apparaît dans le catalogue Ollama de DevForge.

## 1. Exporter les traces (sur l'instance DevForge)

```bash
php artisan devforge:export-agent-sft --path=storage/app/qlora/agent-sft.jsonl
```

Par défaut : traces Relanceur / deploy / repair uniquement
(`name LIKE %Relanceur%` **ou** `type` ∈ `deployment`, `devforge`, `debug`
**ou** `metadata.role = deploy_operator`). Les runs `cancelled` / `failed` / vides sont ignorés.

```bash
# Toutes les teams, tous les types d'agents
php artisan devforge:export-agent-sft --all --path=storage/app/qlora/agent-sft.jsonl

# Une team, plafonné
php artisan devforge:export-agent-sft --team=1 --limit=200 --path=./agent-sft.jsonl
```

Format de chaque ligne :

```json
{"messages":[{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
```

Copier le JSONL vers l'hôte GPU (clé USB, scp, share — **sans IP codée en dur**).

## 2. Entraîner sur l'hôte GPU

Prérequis : Docker, [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html), GPU NVIDIA.

```bash
cd docker/devforge-qlora
mkdir -p data output
# placer agent-sft.jsonl dans data/
chmod +x train.sh
./train.sh data/agent-sft.jsonl output
```

Image : `nvidia/cuda:12.4.1-runtime` + Unsloth.
Base : `unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit`, LoRA `r=16`, séquence 2048.
Sortie : `output/adapter/` (LoRA), GGUF `q4_k_m`, `output/Modelfile` et `output/devforge-relanceur`.

## 3. Publier dans Ollama (même hôte GPU)

```bash
./train.sh --ollama data/agent-sft.jsonl output
# équivalent :
#   cd output && ollama create devforge-relanceur -f ./Modelfile
```

DevForge interroge le catalogue Ollama déjà configuré : le modèle `devforge-relanceur`
apparaît sans toucher au compose ZimaOS/NAS et sans réécrire AgentToolkit.

`OLLAMA_HOST` peut pointer vers le daemon Ollama de l'hôte si besoin (variable d'environnement, jamais une IP en dur dans le dépôt).
