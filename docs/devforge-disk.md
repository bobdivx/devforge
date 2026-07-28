# DevForge — opérateur disque NAS

## Seuil

Alerte si `/media/Docker` a **moins de 20 Go** libres (`DEVFORGE_DISK_WARN_GB`).

```bash
df -h /media/Docker
bash scripts/devforge-disk-prune.sh
```

## Automatique

`nas-fix-devforge.ps1` (mode `images`) exécute `devforge-disk-prune.sh` après `compose up` :
- `docker image prune` (dangling + unused > 72h)
- `docker builder prune` si possible
- `docker container prune`

## Compose

Tous les services DevForge ont `logging: json-file` avec `max-size: 20m`, `max-file: 3`.

## À éviter

- Laisser des images `*:*-build` intermédiaires
- Remplir le volume Docker avec des builds d’apps sans prune
- Monter Postgres Coolify **et** DevForge sur le même data dir en parallèle
