# App GitHub DevForge

DevForge has its own GitHub App. It replaces the personal access token (PAT) and the per-repo webhooks: one app-level webhook, short-lived installation tokens, Check Runs, GitHub Deployments and PR previews.

## Create the app (once per instance)
1. **Réglages › GitHub › « Créer l’app GitHub DevForge »**, optionally with an organisation.
2. GitHub opens with the app manifest pre-filled. Click **Create GitHub App**.
3. DevForge receives the private key, the webhook secret and the client secret. They are sealed (AES-256-GCM, key from `DEVFORGE_SECRET_KEY` or `secret.key`) and never displayed or logged.
4. **« Installer »**: choose the account and the repos (or "All repositories").

## Permissions and why
| Permission | Level | Why |
|---|---|---|
| contents | read | Clone/fetch for deploys |
| metadata | read | Required by GitHub |
| pull_requests | write | PR preview comment |
| checks | write | Check Run « DevForge / deploy » |
| statuses | write | Commit-status fallback |
| deployments | write | « View deployment » in the PR |

Events: `push`, `pull_request`, `check_run`, `check_suite`, plus `installation*` (always sent).

## Feature flag
App mode is active when `DEVFORGE_GITHUB_APP=1` is set or an app is registered. Without it, behaviour is unchanged (PAT plus per-repo webhooks).

## Migrating existing projects
**Réglages › GitHub › Migration des projets**:
1. **Analyser (sans rien modifier)** (dry-run): `POST /api/v1/github-app/migrate` with `{"dry_run": true}`. The report lists each project as *covered* (the app is installed on its repo), *not covered* (install the app on that repo) or *already linked*. No call to GitHub.
2. **Migrer N projet(s)** (after confirmation). For each covered project:
   - links it (`github_installation_id`, `github_repo_id`);
   - records `legacy_webhook_id`;
   - deletes the per-repo DevForge webhook (URL `…/api/v1/webhooks/github`) using the PAT that is still present.
3. **Rollback** for one project: `POST /api/v1/github-app/migrate/rollback` with `{"project_uuid": "…"}`. It unlinks the project and recreates the push webhook.

After migration, `ensure_project_webhook` no longer creates hooks for linked projects. When every project is migrated, a banner suggests deleting the PAT.

The old `/api/v1/webhooks/github` endpoint answers **410 Gone** if `DEVFORGE_LEGACY_WEBHOOK=0`. The default stays `1` for one more version.

## PR previews
- One instance per PR, at `pr-<n>-<slug>.<prod zone>`.
- One comment per project, edited on every change.
- Cleaned up when the PR closes, or after 7 days without activity.
- **Fork PRs are never deployed** (neutral check instead).
- Only env vars flagged `preview` are injected, plus `DEVFORGE_PREVIEW`, `DEVFORGE_PREVIEW_PR` and `DEVFORGE_PREVIEW_URL`.
- Limits: `DEVFORGE_PREVIEW_MEMORY` (1g) and `DEVFORGE_PREVIEW_CPUS` (1).

## Rotation and revocation
- **Webhook secret**: `POST /api/v1/github-app/rotate-webhook-secret` (admin). It generates a secret, sends it to GitHub (`PATCH /app/hook/config`, app JWT), then stores it sealed. Deliveries signed with the old secret are rejected right away.
- **Private key**: on GitHub (app settings › *Private keys*), generate a new key and delete the old one. Then use **« Oublier l’app »** and create it again, or re-import the key.
- **Revocation**: uninstall the app on GitHub. DevForge marks the installation as deleted and flags linked projects as "disconnected". Re-link them (Git › « Choisir le dépôt depuis l’app GitHub ») or roll back.

## Troubleshooting deliveries
- `GET /api/v1/github-app/deliveries`: the latest deliveries with event, status and duration.
- 401 means a bad signature (secret out of sync, so rotate it). 503 means no app is configured.
- 429 means the rate limit was hit (`DEVFORGE_WEBHOOK_RATE_PER_MIN`, default 600/min).
- Already-seen deliveries are ignored (deduplicated by `X-GitHub-Delivery`).
- GitHub side: app settings › *Advanced* › *Recent deliveries* › *Redeliver*.

## Replacing the old third-party deploy app
Once previews are validated on a repo (working URL, single comment, cleanup on close), uninstall the third-party deploy app from that repo on GitHub (*Settings › GitHub Apps*).
