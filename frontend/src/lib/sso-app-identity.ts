import type { InstanceSsoAppIdentity, InstanceSsoSettings } from './api/domain';

export type SsoAppIdentity = InstanceSsoAppIdentity;

export const DEFAULT_SSO_APP_IDENTITY: SsoAppIdentity = {
    strategy: 'oidc_login_optional',
    logout_path: '/oauth2/sign_out',
    headers: {
        email: 'X-Auth-Request-Email',
        user: 'X-Auth-Request-User',
        name: 'X-Auth-Request-Preferred-Username',
        groups: 'X-Auth-Request-Groups',
    },
    oidc_env_keys: [
        'OIDC_ISSUER',
        'OIDC_ISSUER_URL',
        'OIDC_DISCOVERY_URL',
        'OIDC_CLIENT_ID',
        'OIDC_CLIENT_SECRET',
        'OIDC_SCOPES',
        'POCKET_ID_URL',
        'AUTH_POCKET_ID_ID',
        'AUTH_POCKET_ID_SECRET',
        'AUTH_POCKET_ID_ISSUER',
    ],
};

export function ssoAppIdentity(sso: InstanceSsoSettings): SsoAppIdentity {
    return {
        ...DEFAULT_SSO_APP_IDENTITY,
        ...(sso.app_identity ?? {}),
        headers: {
            ...DEFAULT_SSO_APP_IDENTITY.headers,
            ...(sso.app_identity?.headers ?? {}),
        },
    };
}

export function ssoIssuerUrl(sso: InstanceSsoSettings): string {
    return (sso.pocket_id_url ?? 'https://id.exemple.com').replace(/\/$/, '');
}

export function ssoCursorPrompt(sso: InstanceSsoSettings): string {
    const identity = ssoAppIdentity(sso);
    const issuer = ssoIssuerUrl(sso);
    const envKeys = identity.oidc_env_keys.join(', ');
    const emailHeader = identity.headers.email;

    return `Objectif : ajouter Pocket ID (SSO DevForge) comme moyen de connexion OPTIONNEL dans cette app. Ce n’est PAS le seul moyen de s’identifier.

Règle produit
- Le login existant (email/mot de passe, magic link, etc.) RESTE.
- Sur chaque écran de connexion : bouton « Continuer avec Pocket ID » (ou « Continuer avec SSO »).
- Un utilisateur peut lier Pocket ID depuis son compte (réglages / profil).
- Dès qu’un utilisateur a lié le SSO, CETTE façon devient sa connexion : au prochain login, proposer Pocket ID en premier (et désactiver ou masquer le mot de passe pour CE user uniquement). Les autres users gardent le login classique.
- Ne PAS forcer tout le monde sur Pocket ID. Ne PAS supprimer register / forgot password pour ceux qui n’ont pas lié le SSO.

Contexte DevForge (déjà en place, ne pas recréer un client OIDC)
- Issuer Pocket ID : ${issuer}
- Discovery : ${issuer}/.well-known/openid-configuration
- Au redéploiement, DevForge injecte : ${envKeys}
- Callback : origin de CETTE app (ex. https://mon-app.briseteia.me/api/auth/callback/pocket-id ou la route OIDC du projet). Le client Pocket ID « DevForge Apps » accepte déjà https://*.briseteia.me/**
- Scopes : openid email profile
- Identifiant stable : email (claim email). Lier / retrouver le user local par email.

À faire
1. Redéploie l’app sur DevForge pour recevoir les variables OIDC si elles ne sont pas encore là.
2. Ajoute un provider OIDC Pocket ID avec OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET (alias Auth.js : AUTH_POCKET_ID_ID, AUTH_POCKET_ID_SECRET, AUTH_POCKET_ID_ISSUER).
3. Page login : garder le formulaire actuel + bouton SSO.
4. Après callback : findUserByEmail(email) ou createUser. Stocker pocket_id_sub (ou équivalent) sur le user. Marquer sso_linked_at.
5. Profil : « Lier Pocket ID » / « Délier Pocket ID ». Délier rétablit le login mot de passe pour CE user.
6. Si sso_linked_at est défini : le login mot de passe de CE user est refusé ou masqué ; le bouton SSO est le chemin. Message clair : « Ce compte se connecte avec Pocket ID ».
7. Logout = session de l’app uniquement. Ne pas imposer une déconnexion Pocket ID globale (l’utilisateur peut avoir d’autres apps ouvertes).
8. Si le projet est Astro : composants Preact uniquement.

Ne pas faire
- Ne pas mettre une barrière Traefik / forward-auth comme seul accès (en-tête ${emailHeader}) : ça supprimerait le login classique pour tout le monde.
- Ne pas créer un client OIDC Pocket ID à la main.
- Ne pas ajouter une nouvelle lib d’auth si le projet en a déjà une (Auth.js, Better Auth, Lucia, etc.) : étendre l’existante.
- Changement minimal, tests du lien de compte + du bouton SSO.

Réponds en français. Liste les fichiers modifiés et comment tester (page login : formulaire + bouton SSO ; lier un compte ; reconnecter uniquement via SSO pour ce user).
`;
}
