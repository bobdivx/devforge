# Démarrage rapide

## 1. Lancer une instance

**Windows** : lance `DevForge-Setup-<version>-x64.exe`. L’assistant installe DevForge et ouvre `http://127.0.0.1:8000`.

**Linux** : installe d’abord Flatpak (`sudo pacman -S flatpak` sur Arch/CachyOS, après `pacman -Syu` si besoin), puis :

```bash
flatpak install --user ./DevForge-<version>-x86_64.flatpak
flatpak run io.github.bobdivx.DevForge
```

Ne pas ouvrir le `.flatpak` avec CachyOS Package Installer — utiliser le terminal ou Discover. Détails : [[Installation]].

**Docker :**

```bash
export DEVFORGE_VERSION=2.0.68   # ou la dernière release
docker compose up -d
```

Compose racine : UI + API sur le port **8000**. Données dans `./data` (SQLite + workdirs).

Sans Compose :

```bash
docker run -d --name devforge \
  -p 8000:8000 \
  -p 5433:5433 \
  -v ./data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  bobdivx/devforge:latest
```

Détails : [[Installation]].

## 2. Premier écran

Ouvre `http://127.0.0.1:8000`.

- **Créer une instance** — compte admin, puis wizard (nom, URL, domaine apps, GitHub).
- **Rejoindre** — coller URL + token d’invitation du leader. Cette machine devient un **worker**.

Détails : [[Premier-demarrage]] · [[Cluster]].

## 3. Configurer le minimum

Dans **Settings** (admin) :

1. **Général** — nom + URL publique de l’instance
2. **Domaine** — wildcard apps (`apps.example.com`)
3. **GitHub** — PAT (`repo` ; `admin:repo_hook` pour l’auto-création des webhooks)
4. **Agents / LLM** — clé OpenAI-compatible (sinon les agents restent en stub)
5. **Serveur** — Docker local par défaut ; SSH optionnel pour un hôte distant

## 4. Première app

- **Importer** un repo GitHub, ou
- **Scaffold** depuis un prompt (builder) : l’agent Deploy crée le repo, écrit les fichiers, déploie.

Workspace = chat agent à gauche, preview à droite. Voir [[Projets]] · [[Builder-et-agents]].

## Dev local (contributeurs)

```bash
npm install
npm run dev
# front http://127.0.0.1:8080  ·  API http://127.0.0.1:8000
```

Voir [[Developpement]].
