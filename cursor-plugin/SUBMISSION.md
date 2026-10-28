# Soumission du plugin DevForge au catalogue

Texte prêt à copier pour :

- **Grok Bot + Cursor** : https://x.ai/bot/marketplace/submit-a-plugin
- **Cursor** : https://cursor.com/marketplace/publish (connexion Cursor requise pour voir le formulaire)

Aucun secret dans ce fichier. Les valeurs entre `‹…›` sont à remplir par Mathieu.

## Valeurs à copier

| Champ | Valeur |
| --- | --- |
| Nom du plugin | `devforge` (et `devforge-self-hosted`) |
| Nom affiché | DevForge |
| Catégorie | Developer tools / DevOps (déploiement, PaaS) |
| Dépôt GitHub public | https://github.com/bobdivx/devforge |
| Manifeste multi-plugins | https://github.com/bobdivx/devforge/blob/main/.cursor-plugin/marketplace.json |
| Dossiers des plugins | `cursor-plugin/devforge`, `cursor-plugin/devforge-self-hosted` |
| URL du serveur MCP | https://web.jeser.app/api/v1/mcp |
| Logo (1:1, SVG avec fond) | https://raw.githubusercontent.com/bobdivx/devforge/main/cursor-plugin/devforge/assets/logo.svg |
| Site web | https://web.jeser.app |
| Licence | MIT (uniquement les deux dossiers du plugin ; voir « Licence ») |
| Où être listé | Grok Bot, Cursor (Grok : « coming soon », à cocher si souhaité) |

### Description courte

- **EN** : Deploy and operate your DevForge apps from your agent: projects, deployments, logs, environment variables and code workspace over MCP, with one-click OAuth.
- **FR** : Déploie et pilote tes applications DevForge depuis ton agent : projets, déploiements, journaux, variables d’environnement et atelier de code via MCP, connexion OAuth en un clic.

### Description longue

**EN**

DevForge is a self-hostable PaaS with a built-in code workspace. This plugin connects your
agent to DevForge's MCP server so it can list your projects, read a project's status and
latest deployments, fetch build and runtime logs, manage environment variables, trigger or
cancel a deployment, and work on a code workspace preview or a fix pull request.

Sign-in uses OAuth 2.1 with PKCE and dynamic client registration: the client only knows the
MCP URL, the user approves access on DevForge's consent page with their own account, and no
API key is copied anywhere. Access can be revoked at any time in Account → Tokens → Connected
apps. A bundled rule makes the agent ask for explicit approval before any deployment, repository
write or secret change.

Two plugins are provided: `devforge` (hosted instance at web.jeser.app, zero configuration) and
`devforge-self-hosted` (asks once for your own instance's MCP URL).

**FR**

DevForge est un PaaS auto-hébergeable avec un atelier de code intégré. Ce plugin connecte ton
agent au serveur MCP de DevForge : lister tes projets, lire le statut d’un projet et ses
derniers déploiements, récupérer les journaux de build et d’exécution, gérer les variables
d’environnement, lancer ou annuler un déploiement, travailler sur une preview d’atelier ou une
PR de correction.

La connexion passe par OAuth 2.1 avec PKCE et enregistrement dynamique de client : le client ne
connaît que l’URL MCP, l’utilisateur approuve l’accès sur la page de consentement DevForge avec
son propre compte, aucune clé API n’est copiée. L’accès se révoque à tout moment dans
Compte → Tokens → Applications connectées. Une règle incluse impose un accord explicite avant
tout déploiement, écriture dans un dépôt ou modification de secret.

Deux plugins : `devforge` (instance hébergée web.jeser.app, aucune configuration) et
`devforge-self-hosted` (demande une fois l’URL MCP de ton instance).

### Description brève (champ « Brief Description » x.ai, EN)

DevForge MCP plugin: list projects, check deployment status, read logs, manage env vars and
trigger deployments on DevForge (self-hostable PaaS). One-click OAuth sign-in with the user's
DevForge account; no API key. Hosted (web.jeser.app) and self-hosted variants.

### Instructions de test (champ « Testing Instructions », EN)

1. Install the `devforge` plugin and click **Connect** on the `devforge` MCP server.
2. The browser opens https://web.jeser.app/oauth/consent/ ; sign in with a DevForge account
   (‹compte de test : à fournir par Mathieu si les reviewers n’en créent pas un›) and approve.
3. Ask: **"List my DevForge projects and the status of the latest deployment"**.
4. Expected: the agent calls `list_projects`, then `get_project` / `list_deployments`, and
   answers with each project and its latest deployment status. No deployment or write happens
   without explicit approval (see `rules/devforge-safety.mdc`).

### Notes OAuth / inscription

- Découverte : un appel non authentifié à `https://web.jeser.app/api/v1/mcp` répond `401` avec
  `WWW-Authenticate: Bearer resource_metadata="https://web.jeser.app/.well-known/oauth-protected-resource/api/v1/mcp", scope="mcp"`.
- Métadonnées : `https://web.jeser.app/.well-known/oauth-authorization-server` (PKCE S256,
  `authorization_code` + `refresh_token`, scopes `mcp offline_access api`,
  `client_id_metadata_document_supported: true`).
- Enregistrement dynamique (RFC 7591) : `POST https://web.jeser.app/oauth/register`, ouvert
  sans authentification (redirect_uri `https`, `http` loopback ou schéma d’application
  personnalisé acceptés). Aucun client pré-enregistré n’est nécessaire pour Cursor ni Grok Bot.
- Les reviewers ont besoin d’un **compte DevForge** pour passer l’écran de consentement.

## Checklist des champs

### x.ai/bot/marketplace/submit-a-plugin (relevé le 2026-10-29)

- [ ] First Name * — Mathieu
- [ ] Last Name * — Jeser
- [ ] Work Email * — ‹e-mail pro›
- [ ] Organization Name * — ‹DevForge ou nom de la structure›
- [ ] Organization Handle * (minuscules, sans espace) — ‹ex. `devforge` ou `bobdivx`›
- [ ] Website URL — https://web.jeser.app
- [ ] Logotype URL * (1:1, SVG/PNG avec fond) — URL du logo ci-dessus
- [ ] Where do you want to be listed? * — Grok Bot, Cursor (Grok : coming soon)
- [ ] MCP Server URL or Public GitHub Repository * — https://github.com/bobdivx/devforge
- [ ] Brief Description * — voir ci-dessus
- [ ] Testing Instructions * — voir ci-dessus
- [ ] Case « I've tested this plugin locally and in-app and confirmed it works as expected » *
- [ ] Acceptation des Publisher Terms (lien sur la page)

### cursor.com/marketplace/publish

Le formulaire n’est visible qu’une fois connecté à Cursor (« Sign in to apply »). D’après la
documentation (https://cursor.com/docs/reference/plugins, « Submission checklist ») :

- [x] `.cursor-plugin/plugin.json` valide dans chaque plugin
- [x] `name` unique, minuscules, kebab-case (`devforge`, `devforge-self-hosted`)
- [x] `description` claire
- [x] Composants avec fichiers et frontmatter valides (skill `devforge`, règle `devforge-safety`)
- [x] Logo commité et référencé en chemin relatif (`assets/logo.svg`)
- [x] `README.md` (usage et configuration) dans chaque plugin
- [x] `${DEVFORGE_MCP_URL}` déclarée dans `variables` du manifeste self-hosted
- [x] Chemins relatifs, sans `..` ni chemin absolu
- [x] `.cursor-plugin/marketplace.json` à la racine, noms uniques
- [x] Licence open source (MIT) pour les dossiers des plugins
- [ ] Dépôt public (vérifié : public le 2026-10-29) et URL du dépôt soumise
- [ ] Testé en local (`~/.cursor/plugins/local/devforge`, voir README)
- [ ] Champs du formulaire connecté (identité de l’éditeur, e-mail, entreprise) — à relever une
      fois connecté
- [ ] Cursor Marketplace Publisher Terms : https://cursor.com/marketplace-publisher-terms
      (vérification d’identité et de légitimité de l’éditeur)

## Licence

Seuls `cursor-plugin/devforge/` et `cursor-plugin/devforge-self-hosted/` sont sous MIT. Le
reste du dépôt garde sa licence (`license = "proprietary"` dans `Cargo.toml`). Les catalogues
exigent des plugins open source : le code soumis (les dossiers du plugin) l’est ; le serveur
MCP distant, lui, n’est pas un composant livré par le plugin.

## À vérifier par Mathieu avant d’envoyer

- [ ] Le dépôt `bobdivx/devforge` doit rester **public** (il l’est au 2026-10-29).
- [ ] L’inscription OAuth dynamique de web.jeser.app est ouverte : OK. Vérifier en plus que
      **la création de compte DevForge** est possible pour les reviewers, ou leur fournir un
      compte de test (identifiants à transmettre hors dépôt).
- [ ] E-mail professionnel à utiliser (Work Email).
- [ ] Nom et identifiant d’organisation (Organization Name / Handle).
- [ ] Lire et accepter les conditions éditeur (x.ai Publisher Terms, Cursor Marketplace
      Publisher Terms).
- [ ] Accepter que la licence MIT s’applique aux dossiers du plugin.
- [ ] Tester le plugin en local dans Cursor et dans Grok Bot avant de cocher la case de test.
