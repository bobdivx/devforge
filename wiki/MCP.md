# MCP

DevForge est **serveur MCP** (ses tools agent) et **client MCP** (serveurs distants pour les agents).

## Serveur (tools DevForge)

`GET /api/v1/mcp/tools` — schéma MCP des tools locaux.  
JSON-RPC : `POST /api/v1/mcp`.

Les agents DevForge consomment déjà ce registry en interne.

Transport : MCP Streamable HTTP (réponses JSON, notifications → `202`). Auth Bearer :

- session `df_…` ou token API `dfat_…` (Compte → Tokens) ;
- access token OAuth `dfoa_…` (connecteurs distants, voir ci-dessous).

### Connecteur Grok (et autres clients OAuth)

Dans Grok : **Connecteurs → Nouveau connecteur → Personnalisé**, URL du serveur :
`https://<instance>/api/v1/mcp`. Laisse Client ID / Client Secret vides.

Découverte OAuth 2.1 :

- `401` sur le MCP + `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/v1/mcp"`
- `GET /.well-known/oauth-protected-resource[/api/v1/mcp]` (RFC 9728)
- `GET /.well-known/oauth-authorization-server` (RFC 8414)
- `POST /oauth/register` (DCR, RFC 7591) — ou `client_id` en URL https (Client ID Metadata Document ; sans document JSON, la `redirect_uri` doit partager l’origine du `client_id`, ex. `https://grok.com`)
- `GET /oauth/authorize` (PKCE S256 obligatoire) → page de consentement `/oauth/consent/` (session DevForge / Pocket ID)
- `POST /oauth/token` (`authorization_code`, `refresh_token` tournant), `POST /oauth/revoke`

Access token 1 h, refresh 90 jours. Les tokens OAuth ne valent que pour le MCP (pas l’API REST).
Applications connectées et révocation : **Compte → Tokens**. L’URL publique vient de l’URL d’instance
(Admin → Domaine), sinon des en-têtes `Host` / `X-Forwarded-Proto`.

## Client (serveurs distants)

Page **MCP** (`/app/mcp`) :

- Catalogue (Turso, Slack, GitHub, …)
- `GET/POST /api/v1/mcp/servers`
- Tools distants : `GET /api/v1/mcp/servers/{id}/tools`
- OAuth : start / callback / disconnect + `client-metadata.json`

Outils agent : `mcp_list_servers`, `mcp_list_remote_tools`, `mcp_call_tool`.

Sans MCP GitHub, `create_github_repo` échoue avec un hint vers Settings → MCP.

## OAuth MCP

Redirect : `/api/v1/mcp/oauth/callback`. Configure l’URL d’instance avant de lancer un flow.
