# UI — Plasma-inspired (Preact + Chart.js + motion)

Référence : [Plasma](https://tailkits.com/templates/plasma/) — dark épuré, accents violet, app vivante sans surcharge.

## Motion réutilisable (`ui/`)

| Composant | Rôle |
|-----------|------|
| `FadeIn` | entrée douce |
| `Spinner` / `PulseDot` | activité |
| `ProgressBar` | progression lifecycle |
| `LiveStatus` | retour d’état |
| `Skeleton` | chargement |
| `ToastProvider` / `useToast` | feedback actions (dans `AppShell`) |
| `ChartCanvas` | Chart.js |

## Pages app

| Route | État |
|-------|------|
| `/` | Landing marketing |
| `/app` | Accueil + charts |
| `/app/projects` | Liste + **wizard GitHub** (repo → branch → **detect** → build → runtime) |
| `/app/mcp` | Catalogue MCP (Turso, Slack…) + serveurs connectés |
| `/app/projects/view` | Détail : env (**lien Turso**), domaines, settings, deploy |
| `/app/projects/view` | Overview, deployments, agents, env (**import .env**), domains, **settings**, backups |
| `/app/team` | Membres + invite toast |
| `/app/settings` | Santé backends + DB |
| `/app/storage` | Buckets / objets S3 |

## Règle

Feedback animé sur les actions (toast + LiveStatus + progress) — pas de confetti partout.
