# Interface

Front : **Astro + Preact** uniquement (`apps/web`). Design sombre type Plasma / PandaOS : grille de cartes, nav fine, toasts plutôt que confettis.

## Routes

| Route | Rôle |
|-------|------|
| `/` | Landing |
| `/login` · `/register` | Auth, setup, **Rejoindre un cluster** |
| `/app/onboarding` | Wizard admin |
| `/app` | Accueil apps |
| `/app/projects` · `/app/projects/view` | Liste + détail projet |
| `/app/runners` | Runners GitHub self-hosted |
| `/app/cluster` | Nœuds (admin) — y compris MAJ DevForge des workers |
| `/app/node` | Statut worker |
| `/app/mcp` | Serveurs MCP |
| `/app/tokens` | Tokens API |
| `/app/team` | Compte / membres |
| `/app/settings` | Instance |
| `/app/admin` | Opérateur (`instance_admin`) |
| `/app/storage` | Buckets S3 |
| `/app/update` | Self-update |

## Nav globale

Apps · Runners · **Cluster** (admin) · MCP · Tokens · Compte · Settings.

Mobile : dock Apps · Plus · Runners. « Plus » ouvre MCP, Tokens, Compte, Paramètres, Admin.

## Nav projet

Overview · **Workspace** · Deployments · Git · Actions · Agents · Domains · Database · Env · Backups · Settings.

Le workspace est le poste de travail builder : chat + preview. Voir [[Atelier]].

## Settings instance

Général · Domaine · GitHub · Serveur · Agents / LLM · SSO / OIDC · Sauvegardes · Mise à jour.

## Feedback

Toasts, `LiveStatus`, barres de progression sur les lifecycles. Composants dans `apps/web/src/components/ui/`.
