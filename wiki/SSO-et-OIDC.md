# SSO et OIDC

Deux niveaux distincts.

## 1. Login plateforme (DevForge lui-même)

Settings → SSO :

- Activer « connexion SSO à DevForge »
- Issuer, client ID/secret (Pocket ID ou OIDC générique)
- Option **masquer le login local** — seulement si SSO **et** OIDC sont OK. Teste avant.

Bouton login : « Continuer avec SSO » / « Continuer avec Pocket ID ».

Redirect URI à déclarer dans l’IdP :

```
{instance_url}/api/v1/auth/sso/callback
```

Flux : authorize → callback (`state` CSRF 15 min + nonce) → userinfo (email requis) → session.

Mapping :

- Email existant (insensible à la casse) → login
- Aucun user + instance vide → création **admin**
- Inscription ouverte → création user
- Sinon → refus

Comptes SSO-only : hash placeholder, pas de mot de passe tant qu’un admin n’en définit un.

`hide_local_login` **exige** SSO activé + OIDC configuré. Override : `DEVFORGE_FORCE_LOCAL_LOGIN=1`.

### Pocket ID

```
Provider: pocket_id
Issuer: https://id.example.com
Client ID: devforge
```

### OIDC générique (Keycloak, Authentik, …)

```
Provider: generic
Issuer: https://auth.example.com/realms/main
Client ID: devforge-platform
Scopes: openid email profile
```

## 2. OIDC par application déployée

Client **dédié** `devforge-app-{slug}` sur Pocket ID. Le client `devforge` reste réservé à l’UI admin.

```
POST /api/v1/projects/{uuid}/oidc/provision
```

Prérequis : `production_url`, token API Pocket ID, provider `pocket_id`.

Callbacks générés depuis l’URL de prod (`/api/auth/callback/pocket-id`, `/oauth2/callback`, etc.) — pas de wildcard partagé entre apps.

Les secrets OIDC sont injectés dans l’env du projet.
