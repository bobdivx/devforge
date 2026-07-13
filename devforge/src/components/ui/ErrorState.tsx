import { AlertTriangle, LogIn, RefreshCw } from 'lucide-preact';
import { ApiError } from '../../lib/api-client';

type ErrorStateProps = {
    error: unknown;
    onRetry: () => void;
};

const messages: Record<number, { title: string; description: string }> = {
    401: {
        title: 'Session requise',
        description: 'Connectez-vous à Coolify pour ouvrir votre espace DevForge.',
    },
    403: {
        title: 'Accès refusé',
        description: 'Votre rôle ne permet pas d’accéder à cette ressource.',
    },
    419: {
        title: 'Session expirée',
        description:
            'Le jeton de sécurité a expiré. Vérifiez que le FQDN Coolify correspond à l’URL utilisée, puis reconnectez-vous.',
    },
};

export function ErrorState({ error, onRetry }: ErrorStateProps) {
    const status = error instanceof ApiError ? error.status : 0;
    const message = messages[status] ?? {
        title: 'DevForge est indisponible',
        description: 'La connexion au backend Coolify a échoué.',
    };

    return (
        <div class="grid min-h-[18rem] place-items-center px-4">
            <div class="w-full max-w-md border border-base-300 bg-base-100 p-5 text-center">
                <AlertTriangle class="mx-auto size-6 text-warning" aria-hidden />
                <h1 class="mt-3 text-base font-semibold">{message.title}</h1>
                <p class="mt-1 text-sm text-base-content/60">{message.description}</p>
                <div class="mt-4 flex justify-center gap-2">
                    {(status === 401 || status === 419) && (
                        <a class="btn btn-primary btn-sm" href="/login?redirect=/devforge/">
                            <LogIn class="size-4" aria-hidden />
                            Se connecter
                        </a>
                    )}
                    <button class="btn btn-sm" type="button" onClick={onRetry}>
                        <RefreshCw class="size-4" aria-hidden />
                        Réessayer
                    </button>
                </div>
            </div>
        </div>
    );
}
