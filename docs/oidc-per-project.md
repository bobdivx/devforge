# Clients OIDC dédiés par projet

## Vue d'ensemble

DevForge provisionne automatiquement un client OIDC Pocket ID **dédié** pour chaque application déployée, tout en conservant le client partagé `devforge` exclusivement pour l'interface d'administration de la plateforme.

## Architecture

### Séparation des clients

```
┌─────────────────────────────────────────────────────────┐
│ Pocket ID (SSO Provider)                                │
│                                                           │
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │ Client: devforge │  │ Client: devforge-│            │
│  │                  │  │   app-popcorn    │            │
│  │ Usage: UI admin  │  │                  │            │
│  │ DevForge         │  │ Usage: App       │  ...       │
│  └──────────────────┘  │ popcornn.app     │            │
│                        └──────────────────┘            │
└─────────────────────────────────────────────────────────┘
         │                         │
         │                         │
         v                         v
┌────────────────┐        ┌──────────────────┐
│ DevForge UI    │        │ App: popcornn    │
│ forge.acme.com │        │ popcornn.app     │
└────────────────┘        └──────────────────┘
```

### Identité utilisateur unique

Les utilisateurs finaux gardent **un seul compte Pocket ID** (SSO unifié). La séparation des clients OIDC concerne uniquement l'isolation technique et sécuritaire des applications, pas l'identité utilisateur.

## Provisionnement

### Automatique via API

Pour provisionner un client OIDC dédié pour un projet :

```bash
POST /api/v1/projects/{uuid}/oidc/provision
Content-Type: application/json

{
  "force_new_secret": false  # optionnel
}
```

**Prérequis** :
- `production_url` configurée sur le projet
- `sso_pocket_id_api_token` configuré dans les settings SSO
- Provider OIDC = `pocket_id`

**Résultat** :
- Création du client `devforge-app-{slug}` sur Pocket ID
- Génération du `client_secret`
- Stockage en base SQLite (`project_oidc_clients`)
- Mise à jour automatique des variables d'environnement du projet

### Callbacks générés

Le système génère des callbacks **précis** basés sur `production_url` :

```
https://{production_url}/api/auth/callback/pocket-id
https://{production_url}/api/auth/callback/pocket-id/
https://{production_url}/api/auth/callback/oidc
https://{production_url}/api/auth/callback/oidc/
https://{production_url}/oauth2/callback
https://{production_url}/oauth2/callback/
```

Plus de wildcards `*.domain` partagés entre applications.

## Variables d'environnement

Lors du provisionnement, les variables suivantes sont automatiquement injectées/mises à jour :

```env
OIDC_ISSUER=https://id.jeser.app
OIDC_ISSUER_URL=https://id.jeser.app
OIDC_DISCOVERY_URL=https://id.jeser.app/.well-known/openid-configuration
OIDC_CLIENT_ID=devforge-app-my-app
OIDC_CLIENT_SECRET=****************
OIDC_SCOPES=openid email profile
OIDC_PROVIDER=pocket_id
OIDC_REDIRECT_URI=https://my-app.example.com/api/auth/callback/pocket-id

# Pocket ID specific
POCKET_ID_URL=https://id.jeser.app
AUTH_POCKET_ID_ID=devforge-app-my-app
AUTH_POCKET_ID_SECRET=****************
AUTH_POCKET_ID_ISSUER=https://id.jeser.app
AUTH_POCKET_ID_REDIRECT_URI=https://my-app.example.com/api/auth/callback/pocket-id

# Next.js Auth.js
AUTH_URL=https://my-app.example.com
NEXTAUTH_URL=https://my-app.example.com
AUTH_TRUST_HOST=true
```

## Migration des projets existants

### Comportement avant provisionnement

Les projets existants continuent d'utiliser le client partagé plateforme (`sso_apps_client_id` dans `instance_settings`).

### Comportement après provisionnement

1. `ensure_oidc_env()` détecte l'existence d'un client dédié
2. Les variables `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, etc. sont **remplacées** par celles du client dédié
3. Le déploiement suivant utilise automatiquement les nouvelles credentials

### Rollback

Pour revenir au client partagé :

```sql
DELETE FROM project_oidc_clients WHERE project_uuid = '{uuid}';
```

Au prochain appel de `ensure_oidc_env()`, le projet utilisera à nouveau le client partagé.

## Vérification du statut

```bash
GET /api/v1/projects/{uuid}/oidc
```

Réponse :

```json
{
  "ok": true,
  "provider": "pocket_id",
  "has_dedicated_client": true,
  "client_id": "devforge-app-my-app",
  "derived_client_id": "devforge-app-my-app",
  "callbacks": [
    "https://my-app.example.com/api/auth/callback/pocket-id",
    "https://my-app.example.com/oauth2/callback"
  ],
  "ready_to_provision": true,
  "production_url": "https://my-app.example.com"
}
```

## Code applicatif

### Next.js + Auth.js (NextAuth)

Les applications Next.js utilisant Auth.js doivent configurer le provider Pocket ID :

```typescript
// auth.ts
import NextAuth from "next-auth";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    {
      id: "pocket-id",
      name: "Pocket ID",
      type: "oidc",
      issuer: process.env.AUTH_POCKET_ID_ISSUER,
      clientId: process.env.AUTH_POCKET_ID_ID,
      clientSecret: process.env.AUTH_POCKET_ID_SECRET,
      authorization: { params: { scope: "openid email profile" } },
    },
  ],
  // ...
});
```

Les variables d'environnement sont automatiquement injectées par DevForge.

### Autres frameworks

Pour d'autres frameworks (Laravel, Django, etc.), configurer le provider OIDC générique avec les variables `OIDC_*` injectées.

## Sécurité

### Isolation

- Chaque application dispose de son propre `client_secret`
- La rotation d'un secret n'impacte qu'une seule application
- Les callbacks sont restreints au domaine de l'application

### Stockage

Les `client_secret` sont stockés dans la table `project_oidc_clients` avec le flag `secret=1`, ce qui active le chiffrement au repos via SQLite cipher (même mécanisme que `project_env_vars`).

### API Pocket ID

L'API Pocket ID requiert un token admin (`sso_pocket_id_api_token`) pour créer/modifier des clients. Ce token est stocké chiffré dans `instance_settings`.

## Troubleshooting

### "production_url requis pour provisionner"

Le système nécessite `production_url` pour générer les callbacks. Configurez-la d'abord :

```bash
PATCH /api/v1/projects/{uuid}
{
  "production_url": "https://my-app.example.com"
}
```

### "Le provider OIDC doit être pocket_id"

Le provisionnement automatique ne fonctionne qu'avec Pocket ID. Pour d'autres providers OIDC, configurez manuellement le client et ajoutez les credentials dans `project_env_vars`.

### "Token API Pocket ID manquant"

Configurez le token API admin dans les settings SSO :

```bash
PUT /api/v1/settings/sso
{
  "provider": "pocket_id",
  "pocket_id_url": "https://id.jeser.app",
  "pocket_id_api_token": "pk_************"
}
```

### Client créé mais app ne s'authentifie pas

Vérifiez que l'application utilise bien le provider Pocket ID dans son code (voir section "Code applicatif" ci-dessus). DevForge injecte les variables d'environnement, mais le code de l'application doit être configuré pour les utiliser.

## Référence API

### GET /api/v1/projects/{uuid}/oidc

Retourne le statut du client OIDC du projet.

**Réponse** :
- `has_dedicated_client` : `true` si un client dédié existe
- `client_id` : client_id actuel (ou `null` si non provisionné)
- `derived_client_id` : client_id qui serait généré lors du provisionnement
- `callbacks` : liste des URLs de callback
- `ready_to_provision` : `true` si les prérequis sont remplis

### POST /api/v1/projects/{uuid}/oidc/provision

Crée ou met à jour le client OIDC dédié.

**Body** :
```json
{
  "force_new_secret": false  // optionnel, défaut false
}
```

**Réponse** :
```json
{
  "ok": true,
  "client_id": "devforge-app-my-app",
  "created_client": true,
  "created_secret": true,
  "callbacks": ["https://..."],
  "env_vars_updated": 12,
  "message": "Client OIDC créé avec succès"
}
```

## Base de données

### Table `project_oidc_clients`

```sql
CREATE TABLE project_oidc_clients (
    project_uuid TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,  -- chiffré au repos
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

### Requêtes utiles

**Lister les projets avec client dédié** :
```sql
SELECT p.name, p.slug, c.client_id, c.updated_at
FROM projects p
JOIN project_oidc_clients c ON p.uuid = c.project_uuid
ORDER BY p.name;
```

**Vérifier les credentials d'un projet** :
```sql
SELECT client_id, created_at, updated_at
FROM project_oidc_clients
WHERE project_uuid = '{uuid}';
```

## Workflow recommandé

1. **Créer le projet** : `POST /api/v1/projects`
2. **Configurer `production_url`** : `PATCH /api/v1/projects/{uuid}`
3. **Provisionner le client OIDC** : `POST /api/v1/projects/{uuid}/oidc/provision`
4. **Vérifier les variables** : `GET /api/v1/projects/{uuid}/env`
5. **Déployer** : `POST /api/v1/projects/{uuid}/deployments`

Les étapes 3-5 peuvent être automatisées dans le workflow de création de projet.
