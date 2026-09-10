# Auth & onboarding

Voir aussi [TENANCY.md](TENANCY.md).

## Users

- Tables : `users`, `teams` (workspaces), `team_members`, `sessions`, `instance_settings`
- Mots de passe : Argon2
- Session : Bearer `df_…`

## First-run

1. **Admin** — `/login` setup → register `instance_admin` → wizard instance/domaine/GitHub/SSH
2. **Users** — `/login` → Créer un compte → workspace isolé `free` → app

## Pages

- `/login` · `/register`
- `/app/onboarding` (admin only)
- `/app/*` via `AuthGate`
