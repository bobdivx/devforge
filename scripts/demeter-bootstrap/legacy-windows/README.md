# Scripts Windows legacy (Demeter avant CachyOS)

Demeter tourne désormais sous **Linux** (`/mnt/ia/pinokio`). Ces scripts PowerShell/BAT
ciblent l’ancienne installation **Windows** (`D:\pinokio`) — conservés pour référence uniquement.

Sur Demeter Linux, utiliser `scripts/demeter-bootstrap/*.sh` (voir README parent).

| Script | Remplacement Linux |
|--------|-------------------|
| `pinokio-litellm-install.ps1` | `clone-pinokio-apps.sh` + Install dans Pinokio |
| `pinokio-demeter-reset-llm.ps1` | `patch-serve-llm-host.sh`, `stabilize-demeter.sh` |
| `pinokio-serve-disable-autoload.ps1` | `setup-demeter-boot.sh` (sans auto-load GGUF) |
| `pinokio-backup-demeter.ps1` | Sauvegarde `/mnt/ia/pinokio` (rsync/tar) |
