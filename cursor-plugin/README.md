# Plugins DevForge (Cursor et Grok Bot)

Deux plugins au format Cursor Plugin (`.cursor-plugin/plugin.json`), listés dans
`.cursor-plugin/marketplace.json` à la racine du dépôt. Le même plugin sert à Cursor et à
Grok Bot : le catalogue Grok Bot reprend le format Cursor.

| Plugin | Dossier | Configuration |
| --- | --- | --- |
| `devforge` | `cursor-plugin/devforge` | Aucune. MCP `https://web.jeser.app/api/v1/mcp`. |
| `devforge-self-hosted` | `cursor-plugin/devforge-self-hosted` | L’URL MCP de ton instance, demandée une fois (`DEVFORGE_MCP_URL`). |

Chaque plugin contient :

- `mcp.json` : le serveur `devforge` (URL seule, aucun en-tête, aucun secret) ;
- `skills/devforge/SKILL.md` : quand et comment utiliser les 43 outils DevForge ;
- `rules/devforge-safety.mdc` : garde-fous (accord explicite avant déploiement, dépôt ou secret) ;
- `assets/logo.svg` : logo carré avec fond.

## Connexion

Le client ne connaît que l’URL MCP. Au premier appel, DevForge répond 401 avec
`WWW-Authenticate: Bearer resource_metadata=…`. Le client lit
`/.well-known/oauth-protected-resource/api/v1/mcp` puis `/.well-known/oauth-authorization-server`,
s’enregistre sur `/oauth/register` (RFC 7591) et ouvre `/oauth/authorize` (PKCE S256).
L’utilisateur approuve sur `/oauth/consent/` avec son compte DevForge. Les accès se révoquent
dans **Compte → Tokens → Applications connectées**.

## Installer en un clic

- **Depuis DevForge** : **Compte → Tokens → Connecter un agent → Connecter à Cursor**.
  Le bouton ouvre le deeplink officiel
  `cursor://anysphere.cursor-deeplink/mcp/install?name=devforge&config=<base64 {"url": "<instance>/api/v1/mcp"}>`
  calculé pour l’instance courante.
- **Grok Bot** : une fois le plugin listé, l’installer depuis **Connect apps**. D’ici là, le
  bouton **Connecter à Grok Bot** copie la phrase à coller dans le chat du Bot.

## Tester en local (Cursor)

Copier `cursor-plugin/devforge` dans `~/.cursor/plugins/local/devforge`, recharger Cursor
(**Developer: Reload Window**), ouvrir **Customize**, activer le serveur `devforge`, puis **Connect**.
Test : « Liste mes projets DevForge et donne le statut du dernier déploiement de chacun. »

## Publier

- Cursor : https://cursor.com/marketplace/publish (URL du dépôt public).
- Grok Bot et Cursor : https://x.ai/bot/marketplace/submit-a-plugin (dépôt GitHub public ou
  URL du serveur MCP, logo 1:1, instructions de test).

Les plugins du marketplace doivent être open source et relus par l’équipe du catalogue.

## Jeton API à la place d’OAuth

Créer un jeton `dfat_…` dans **Compte → Tokens** et l’ajouter en en-tête
`Authorization: Bearer …` dans le `mcp.json` local du client. Ne jamais le committer.

## Licence

Les dossiers `cursor-plugin/devforge/` et `cursor-plugin/devforge-self-hosted/` sont sous
licence MIT (fichier `LICENSE` dans chacun, champ `"license": "MIT"` dans leur
`plugin.json`). **Cette licence MIT ne couvre que ces deux dossiers.** Le reste du dépôt
(serveur, interface web, applications, `Cargo.toml`) n’est pas concerné et garde sa licence
propre (`proprietary`).

Dossier de soumission prêt à copier : [SUBMISSION.md](SUBMISSION.md).
