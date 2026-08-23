import { AlertTriangle, RefreshCw } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { ApiError } from '../../lib/api-client';

type DataStateProps = {
    loading: boolean;
    error: unknown;
    empty?: boolean;
    emptyMessage?: string;
    onRetry: () => void;
    children: ComponentChildren;
};

const statusMessages: Record<number, string> = {
    401: 'Session requise. Connectez-vous à DevForge.',
    403: 'Accès refusé pour cette ressource ou cette équipe.',
    404: 'Ressource introuvable dans l’équipe active.',
    409: 'Équipe active indisponible. Sélectionnez une autre équipe.',
    419: 'Session expirée. Rechargez la page puis réessayez.',
    422: 'Données invalides. Vérifiez les champs saisis.',
    500: 'Erreur serveur. Réessayez dans quelques instants.',
};

function resolveErrorMessage(error: unknown): string {
    if (error instanceof ApiError) {
        if (error.message && !error.message.startsWith('La requête API')) {
            return error.message;
        }

        return statusMessages[error.status] ?? `Erreur HTTP ${error.status}.`;
    }

    if (error instanceof Error && error.message) {
        return error.message;
    }

    return 'Impossible de charger ces données.';
}

export function DataState({
    loading,
    error,
    empty = false,
    emptyMessage = 'Aucune donnée disponible.',
    onRetry,
    children,
}: DataStateProps) {
    if (loading) {
        return (
            <div class="flex min-h-28 items-center justify-center gap-2 text-xs text-base-content/50" role="status">
                <span class="loading loading-spinner loading-xs text-primary" aria-hidden />
                Chargement…
            </div>
        );
    }

    if (error) {
        return (
            <div class="devforge-card flex min-h-28 flex-col items-center justify-center gap-2 p-6 text-center">
                <AlertTriangle class="size-3.5 sm:size-4 text-error" aria-hidden />
                <p class="text-xs text-base-content/70">{resolveErrorMessage(error)}</p>
                <button class="btn btn-ghost btn-sm" type="button" onClick={onRetry}>
                    <RefreshCw class="size-3.5" aria-hidden />
                    Réessayer
                </button>
            </div>
        );
    }

    if (empty) {
        return (
            <div class="devforge-card px-6 py-10 text-center">
                <p class="text-sm text-base-content/50">{emptyMessage}</p>
            </div>
        );
    }

    return <>{children}</>;
}
