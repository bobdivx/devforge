import type { InstanceSsoAppIdentity, InstanceSsoSettings } from './api/domain';

export type SsoAppIdentity = InstanceSsoAppIdentity;

export type SsoCursorPromptContext = {
    appsWildcardDomain?: string | null;
};

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

function withHttps(value: string): string {
    const trimmed = value.trim().replace(/\/$/, '');
    if (trimmed === '') {
        return trimmed;
    }

    return trimmed.includes('://') ? trimmed : `https://${trimmed}`;
}

function hostnameOf(value: string): string | null {
    try {
        return new URL(withHttps(value)).hostname;
    } catch {
        return null;
    }
}

export function ssoIssuerUrl(sso: InstanceSsoSettings): string | null {
    if (!sso.pocket_id_url) {
        return null;
    }

    return withHttps(sso.pocket_id_url);
}

export function ssoAppsOrigin(sso: InstanceSsoSettings, appsWildcardDomain?: string | null): string | null {
    if (filled(appsWildcardDomain)) {
        return withHttps(appsWildcardDomain);
    }

    const pocketHost = sso.pocket_id_url ? hostnameOf(sso.pocket_id_url) : null;
    if (pocketHost) {
        const host = pocketHost.replace(/^id\./, '');
        const protocol = new URL(withHttps(sso.pocket_id_url as string)).protocol;

        return `${protocol}//${host}`;
    }

    const proxyHost = sso.oauth2_proxy_url ? hostnameOf(sso.oauth2_proxy_url) : null;
    if (proxyHost && sso.oauth2_proxy_url) {
        const host = proxyHost.replace(/^sso\./, '');
        const protocol = new URL(withHttps(sso.oauth2_proxy_url)).protocol;

        return `${protocol}//${host}`;
    }

    return null;
}

function filled(value: string | null | undefined): value is string {
    return typeof value === 'string' && value.trim() !== '';
}

export function ssoCursorPrompt(sso: InstanceSsoSettings, context: SsoCursorPromptContext = {}): string {
    const identity = ssoAppIdentity(sso);
    const issuer = ssoIssuerUrl(sso);
    const appsOrigin = ssoAppsOrigin(sso, context.appsWildcardDomain);
    const appsHost = appsOrigin ? hostnameOf(appsOrigin) : null;
    const emailHeader = identity.headers.email;
    const discovery = issuer ? `${issuer}/.well-known/openid-configuration` : null;
    const callbackWildcard = appsOrigin && appsHost
        ? `${new URL(appsOrigin).protocol}//*.${appsHost}/**`
        : null;
    const callbackRoot = appsOrigin ? `${appsOrigin}/**` : null;
    const exampleCallback = appsHost
        ? `https://<ton-app>.${appsHost}/api/auth/callback/pocket-id`
        : 'https://<ton-app>.<domaine>/api/auth/callback/pocket-id';

    const urlsBlock = issuer
        ? `- Issuer Pocket ID : ${issuer}
- Discovery : ${discovery}
- Callbacks déjà autorisés dans Pocket ID : ${[callbackRoot, callbackWildcard].filter(Boolean).join(' et ')}
- Exemple de callback de CETTE app : ${exampleCallback} (adapte le chemin à la route OIDC du projet)`
        : `- Issuer Pocket ID : manquant — définis le domaine de l’instance, puis rouvre ce prompt.
- Ne hardcode aucune URL d’exemple.`;

    return `Objectif : ajouter Pocket ID (SSO DevForge) comme moyen de connexion OPTIONNEL dans cette app. Ce n’est PAS le seul moyen de s’identifier.

Règle produit
- Le login existant (email/mot de passe, magic link, etc.) RESTE.
- Sur chaque écran de connexion : bouton « Continuer avec Pocket ID » (ou « Continuer avec SSO »).
- Un utilisateur peut lier Pocket ID depuis son compte (réglages / profil).
- Dès qu’un utilisateur a lié le SSO, CETTE façon devient sa connexion : au prochain login, proposer Pocket ID en premier (et désactiver ou masquer le mot de passe pour CE user uniquement). Les autres users gardent le login classique.
- Ne PAS forcer tout le monde sur Pocket ID. Ne PAS supprimer register / forgot password pour ceux qui n’ont pas lié le SSO.

URLs de CETTE instance (copie-les telles quelles dans tes tests / docs, pas dans le code runtime)
${urlsBlock}

Dans le code, lis UNIQUEMENT les variables d’environnement injectées au déploiement DevForge (ne hardcode pas l’issuer, le client id ni le secret) :
- OIDC_ISSUER, OIDC_ISSUER_URL, OIDC_DISCOVERY_URL
- OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_SCOPES
- POCKET_ID_URL
- AUTH_POCKET_ID_ID, AUTH_POCKET_ID_SECRET, AUTH_POCKET_ID_ISSUER (alias Auth.js)

Le client Pocket ID « DevForge Apps » existe déjà. Scopes : openid email profile. Identifiant stable : claim email.

À faire
1. Redéploie l’app sur DevForge pour recevoir ces variables si elles ne sont pas encore là.
2. Ajoute un provider OIDC Pocket ID branché sur process.env.OIDC_* (ou AUTH_POCKET_ID_*).
3. Page login : garder le formulaire actuel + bouton SSO.
4. Après callback : findUserByEmail(email) ou createUser. Stocker pocket_id_sub (ou équivalent) sur le user. Marquer sso_linked_at.
5. Profil : « Lier Pocket ID » / « Délier Pocket ID ». Délier rétablit le login mot de passe pour CE user.
6. Si sso_linked_at est défini : le login mot de passe de CE user est refusé ou masqué ; le bouton SSO est le chemin. Message clair : « Ce compte se connecte avec Pocket ID ».
7. Logout = session de l’app uniquement. Ne pas imposer une déconnexion Pocket ID globale.
8. Si le projet est Astro : composants Preact uniquement.

Ne pas faire
- Ne pas mettre une barrière Traefik / forward-auth comme seul accès (en-tête ${emailHeader}) : ça supprimerait le login classique pour tout le monde.
- Ne pas créer un client OIDC Pocket ID à la main.
- Ne pas ajouter une nouvelle lib d’auth si le projet en a déjà une (Auth.js, Better Auth, Lucia, etc.) : étendre l’existante.
- Ne pas écrire https://id.… en dur dans le code : l’URL ci-dessus est pour toi, le runtime lit OIDC_ISSUER.
- Changement minimal, tests du lien de compte + du bouton SSO.

Réponds en français. Liste les fichiers modifiés et comment tester (page login : formulaire + bouton SSO ; lier un compte ; reconnecter uniquement via SSO pour ce user).
`;
}
