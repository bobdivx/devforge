# Installation

DevForge se publie en **image Docker**, en **assistant Windows** et en **Flatpak Linux**. La config métier (domaine, GitHub, LLM, SSO, backups) se fait dans l’UI, pas dans un long fichier d’env.

## Docker Compose (recommandé)

Fichiers :

| Fichier | Usage |
|---------|--------|
| `docker-compose.yml` (racine) | Self-update compose |
| `deploy/docker-compose.yml` | Déploiement classique |
| `deploy/zimaos/docker-compose.yml` | ZimaOS / CasaOS App Store |
| `deploy/zimaos/install.yaml` | Custom App ZimaOS |

```bash
export DEVFORGE_VERSION=2.0.65
docker compose up -d
```

Volumes typiques :

- `${DEVFORGE_DATA_DIR:-./data}:/data` — SQLite, workdirs, backups locaux
- `/var/run/docker.sock` — build / run des apps

Port : `${DEVFORGE_HTTP_PORT:-8000}:8000`.

Images :

- Docker Hub : `bobdivx/devforge:<version>`
- GHCR : `ghcr.io/bobdivx/devforge:<version>`

## ZimaOS / CasaOS

Importer `deploy/zimaos/install.yaml` (Custom App). Laisse les **Variables** vides : tout se configure dans l’UI après le premier login.

Données : `/DATA/AppData/devforge`. Socket Docker monté pour déployer les apps sur la même machine.

## Windows

Télécharge `DevForge-Setup-<version>-x64.exe` depuis les releases GitHub et lance-le. L’assistant demande le dossier (par défaut le profil utilisateur), les raccourcis, puis ouvre le navigateur sur `http://127.0.0.1:8000`.

Les données restent dans le sous-dossier `data/` à côté du programme. Windows peut afficher SmartScreen (« Informations complémentaires ») tant que l’installateur n’est pas signé.

**Docker Desktop** sert à déployer les apps. Sans Docker, l’interface tourne ; les apps PaaS ne se déploient pas.

Pour ne pas ouvrir le navigateur : `DEVFORGE_NO_BROWSER=1`.

## Linux (Flatpak)

```bash
flatpak install --user ./DevForge-<version>-x86_64.flatpak
flatpak run io.github.bobdivx.DevForge
```

Le premier lancement télécharge le runtime Freedesktop si besoin. DevForge apparaît ensuite dans le menu des applications. Les données sont dans le dossier Flatpak de l’app (`~/.var/app/io.github.bobdivx.DevForge`).

Docker et Git doivent être installés **sur la machine** : le Flatpak les appelle directement (socket Docker, dépôts, clés SSH). Node sur la machine sert au repli preview des projets JS. Sans Docker, l’UI tourne ; les apps PaaS ne se déploient pas.

Mise à jour :

```bash
flatpak install --user --or-update ./DevForge-<version>-x86_64.flatpak
```

L’écran Mise à jour de DevForge fait la même chose à partir de la release GitHub.

## Réseau Docker / Traefik

Pour que Traefik route les apps déployées, DevForge et les conteneurs `df-*` doivent partager un réseau :

```bash
DEVFORGE_DOCKER_NETWORK=devforge
```

Valeurs courantes : `devforge`, `traefik-public`, réseau du proxy existant. Sans réseau commun → timeouts / 504. Voir [[Domaines-et-Traefik]] · [[Depannage]].

## Santé

```bash
curl -fsS http://127.0.0.1:8000/api/v1/health
```

La réponse inclut `version` et `backends` (executor, github, storage, database, llm, update, cluster).
