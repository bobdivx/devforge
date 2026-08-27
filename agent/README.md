# devforge-agent

Runtime agents DevForge (Rig). Conteneur `devforge-agent` dans le compose.

- `GET /health`
- `POST /v1/chat` `{"prompt":"...","preamble":"...","model":"..."}`

Env : `AGENT_LISTEN` (défaut `0.0.0.0:8090`), `AGENT_PROVIDER`, `AGENT_BASE_URL`, `AGENT_API_KEY`, `AGENT_MODEL`.
Laravel parle à `AGENT_URL=http://agent:8090`. Le produit (apps, SSH, UI) reste dans l’API PHP.
