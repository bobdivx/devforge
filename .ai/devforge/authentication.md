# Auth dans DevForge

## Décision (juillet 2026)

**Fortify reste hors du shell SPA DevForge** pour login, reset mot de passe, e-mail verification et 2FA.

Raisons :
- Fortify / Blade gère déjà les flux sensibles et les middlewares (`CheckForcePasswordReset`, etc.)
- Évite de dupliquer CSRF, recovery codes et Socialite dans Preact
- Le profil DevForge édite nom/e-mail ; un lien Fortify couvre mot de passe / 2FA

## Conséquences

| Flux | Emplacement |
|------|-------------|
| Login / logout / register | Fortify Blade |
| Mot de passe / 2FA | Fortify (`/user/profile`) via lien DevForge |
| Profil nom/e-mail / apparence | DevForge |
| Shell post-auth | DevForge (`/devforge`) |

Réévaluer une UI auth Preact seulement après cutover Livewire complet (vague 4 optionnelle).
