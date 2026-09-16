# Installation

DevForge se publie en **image Docker** et en **binaire** Linux / Windows. La config métier (domaine, GitHub, LLM, SSO, backups) se fait dans l’UI, pas dans un long fichier d’env.

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

## Binaire (Linux / Windows)

Les zips GitHub sont un **logiciel complet** : exécutable + interface + templates.

- `devforge-server-x86_64-unknown-linux-gnu.zip`
- `devforge-server-x86_64-pc-windows-msvc.zip`

```bash
unzip devforge-server-x86_64-unknown-linux-gnu.zip
cd x86_64-unknown-linux-gnu
./devforge-server
```

Le navigateur s’ouvre sur `http://127.0.0.1:8000`. Les données vont dans le sous-dossier `data/` à côté du programme. **Pas de Docker dans le zip, pas de variables à coller.**

**Docker** est une dépendance du *moteur* (déploiements, Traefik) : Docker Desktop sur Windows/macOS, ou `docker` + service sur Linux. Sans Docker, l’UI tourne ; les apps PaaS ne se déploient pas (sauf fallback Node pour certains projets JS). L’onboarding et Settings → Serveur affichent si le moteur est détecté.

Pour ne pas ouvrir le navigateur : `DEVFORGE_NO_BROWSER=1`.

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
