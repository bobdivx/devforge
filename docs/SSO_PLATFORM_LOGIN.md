# SSO Platform Login - Documentation

## Vue d'ensemble

DevForge supporte désormais la connexion SSO pour la plateforme elle-même (en plus du SSO pour protéger les apps déployées).

## Configuration

### 1. Prérequis

- OIDC configuré (issuer + client ID/secret) dans Settings → SSO
- URL instance configurée (`instance_url` dans les settings)

### 2. Activation

Dans Settings → SSO, activer l'option « Activer la connexion SSO à DevForge ».

### 3. Comportement

#### Option SSO activée

- Page de login affiche un bouton « Continuer avec SSO » (ou « Continuer avec Pocket ID »)
- Flux OIDC standard : authorize → callback → création de session

#### Option `hide_local_login` activée

- **Requiert** que le SSO plateforme soit activé ET OIDC configuré
- Masque le formulaire email/password de la page de login
- ⚠️ **Risque** : si le SSO ne fonctionne pas, l'admin ne peut plus se connecter

### 4. Mapping utilisateurs

**Stratégie conservatrice** :

- Recherche par email (case-insensitive)
- Si utilisateur existant trouvé → authentification réussie
- Si pas d'utilisateur :
  - Si c'est le premier compte (count = 0) → création automatique en tant qu'admin
  - Si inscription ouverte (`DEVFORGE_ALLOW_REGISTER=1`) → création automatique
  - Sinon → **refus** avec message explicite

Pas de création automatique sauf si explicitement autorisé. Cela évite l'ouverture involontaire de l'inscription.

## Sécurité

### Protection CSRF

- `state` token généré via UUID v4 (cryptographiquement sécurisé)
- Stocké en base avec expiration de 15 minutes
- Vérifié lors du callback

### Nonce

- `nonce` généré et stocké avec le state
- Peut être vérifié contre l'ID token (si implémentation future)

### Validation des tokens

- Échange du code contre un access token via endpoint `/token`
- Récupération des claims via endpoint `/userinfo`
- Email requis dans les claims OIDC

### Recovery / Break-glass

**Options si l'admin se verrouille** :

1. **Variable d'environnement override** (implémenté) :
   ```bash
   DEVFORGE_FORCE_LOCAL_LOGIN=1
   ```
   Force l'affichage du formulaire email/password même si `hide_local_login` est activé.
   Redémarrer le serveur après avoir défini cette variable.
   
2. **Accès base de données direct** :
   ```sql
   UPDATE instance_settings SET sso_hide_local_login = 0 WHERE id = 1;
   ```

3. **Recommandation** : toujours tester le SSO **avant** d'activer `hide_local_login`.

## Redirect URI

Le callback SSO est configuré automatiquement :

```
{instance_url}/api/v1/auth/sso/callback
```

**Important** : configurer cette URL dans l'IdP (Pocket ID ou autre fournisseur OIDC).

## Tests

Tests de base dans `platform_sso_tests.rs` :

- Validation des flags SSO
- Vérification de la configuration OIDC minimale
- Documentation des comportements attendus

## Exemples de configuration

### Pocket ID

```
Provider: pocket_id
Issuer: https://id.example.com
Client ID: devforge
API Token: (admin Pocket ID)
```

Le callback sera automatiquement enregistré lors du provisionnement.

### OIDC générique (Keycloak, Authentik, etc.)

```
Provider: generic
Issuer: https://auth.example.com/realms/main
Client ID: devforge-platform
Client Secret: ***
```

Configurer manuellement dans l'IdP :
- Redirect URI: `https://devforge.example.com/api/v1/auth/sso/callback`
- Scopes: `openid email profile`

## Migration depuis l'existant

Si des utilisateurs existent déjà avec email/password :

1. Activer le SSO plateforme (garder `hide_local_login` à `false`)
2. Demander aux utilisateurs de tester la connexion SSO
3. Une fois validé, activer `hide_local_login` si désiré

Les utilisateurs existants seront automatiquement liés par email lors de leur première connexion SSO.

## Notes

- Le password hash des utilisateurs créés via SSO est un placeholder (`SSO_ONLY`)
- Ces utilisateurs ne peuvent **pas** se connecter par mot de passe
- Pour restaurer l'accès password, un admin doit réinitialiser le mot de passe
