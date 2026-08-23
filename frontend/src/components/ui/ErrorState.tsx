import { AlertTriangle, LogIn, RefreshCw } from 'lucide-preact';
import { ApiError } from '../../lib/api-client';
import { DEVFORGE_BASE_PATH } from '../../lib/routes';
import { ActionToolbar } from './ActionToolbar';

type ErrorStateProps = {
    error: unknown;
    onRetry: () => void;
};

const loginRedirect = `${DEVFORGE_BASE_PATH || ''}/` || '/';
const loginHref = `/login?redirect=${loginRedirect}`;

const messages: Record<number, { title: string; description: string }> = {
    0: {
        title: 'Connexion impossible',
        description: 'Le serveur ne répond pas ou met trop de temps. Vérifiez que DevForge tourne, puis réessayez.',
    },
    401: {
        title: 'Session requise',
        description: 'Connectez-vous pour ouvrir votre espace DevForge.',
    },
    403: {
        title: 'Accès refusé',
        description: 'Votre rôle ne permet pas d’accéder à cette ressource.',
    },
    419: {
        title: 'Session expirée',
        description:
            'Le jeton de sécurité a expiré. Vérifiez que l’URL DevForge correspond au FQDN configuré, puis reconnectez-vous.',
    },
};

export function ErrorState({ error, onRetry }: ErrorStateProps) {
    const status = error instanceof ApiError ? error.status : 0;
    const message = messages[status] ?? {
        title: 'DevForge est indisponible',
        description: 'La connexion au backend a échoué.',
    };

    return (
        <div class="grid min-h-[18rem] place-items-center px-3 sm:px-4">
            <div class="w-full max-w-md border border-base-300 bg-base-100 p-5 text-center">
                <AlertTriangle class="mx-auto size-5 sm:size-6 text-warning" aria-hidden />
                <h1 class="mt-3 text-sm sm:text-base font-semibold">{message.title}</h1>
                <p class="mt-1 text-sm text-base-content/60">{message.description}</p>
                <ActionToolbar class="mt-4 justify-center sm:justify-center">
                    {(status === 401 || status === 419) && (
                        <a class="btn btn-primary btn-sm" href={loginHref}>
                            <LogIn class="size-4" aria-hidden />
                            Se connecter
                        </a>
                    )}
                    <button class="btn btn-sm" type="button" onClick={onRetry}>
                        <RefreshCw class="size-4" aria-hidden />
                        Réessayer
                    </button>
                </ActionToolbar>
            </div>
        </div>
    );
}
