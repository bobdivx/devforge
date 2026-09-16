# Authentification

## Modèle

- Mots de passe **Argon2**
- Session Bearer `df_…` (localStorage front)
- Tables : `users`, `teams` (workspaces), `team_members`, `sessions`, `instance_settings`

## First-run

1. Aucun user → `/login` mode setup (`needs_setup`)
2. Premier compte = `instance_admin` + wizard
3. Ou **Rejoindre un cluster** sans créer de compte — [[Premier-demarrage]]

## Pages

| Route | Rôle |
|-------|------|
| `/login` | Setup, login, SSO, join cluster |
| `/register` | Compte user (si inscription ouverte) |
| `/app/onboarding` | Wizard admin |
| `/app/*` | `AuthGate` : setup → login ; worker → `/app/node` ; onboarding requis → wizard |

## Rôles

| Rôle | Droits |
|------|--------|
| `instance_admin` | Instance, cluster, LLM, GitHub, SSO, admin panel |
| `user` | Son workspace uniquement |

## Inscription

- Fermée par défaut (`DEVFORGE_ALLOW_REGISTER=0`)
- SSO : mapping email, pas de création auto sauf premier compte ou inscription ouverte — [[SSO-et-OIDC]]

## Break-glass SSO

Si tu as masqué le login local et que l’IdP est down :

```bash
DEVFORGE_FORCE_LOCAL_LOGIN=1
```

ou en SQL : `UPDATE instance_settings SET sso_hide_local_login = 0 WHERE id = 1;`
