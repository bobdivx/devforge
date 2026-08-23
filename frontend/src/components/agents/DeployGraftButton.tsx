import { Zap, Check, X, Loader2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { apiFetch, ensureCsrfCookie } from '../../lib/api-client';

type DeployStatus = 'idle' | 'deploying' | 'success' | 'error';

type DeployResponse = {
    data: {
        message: string;
        job_dispatched: boolean;
    };
};

export function DeployGraftButton() {
    const [status, setStatus] = useState<DeployStatus>('idle');
    const [message, setMessage] = useState('');

    const handleDeploy = async () => {
        try {
            setStatus('deploying');
            setMessage('');

            await ensureCsrfCookie();
            const response = await apiFetch<DeployResponse>(
                '/api/v1/devforge/graft/deploy-all',
                { method: 'POST' }
            );
            
            setStatus('success');
            setMessage(response.data.message || 'Déploiement Graft lancé ! (~2-3 min)');
            
            // Reset après 5 secondes
            setTimeout(() => {
                setStatus('idle');
                setMessage('');
            }, 5000);
        } catch (error) {
            setStatus('error');
            setMessage(
                error instanceof Error ? error.message : 'Erreur lors du déploiement Graft'
            );
            
            // Reset après 5 secondes
            setTimeout(() => {
                setStatus('idle');
                setMessage('');
            }, 5000);
        }
    };

    const getButtonClass = () => {
        const base = 'btn btn-sm gap-1.5';
        
        switch (status) {
            case 'deploying':
                return `${base} btn-disabled`;
            case 'success':
                return `${base} btn-success`;
            case 'error':
                return `${base} btn-error`;
            default:
                return `${base} btn-ghost`;
        }
    };

    const getIcon = () => {
        switch (status) {
            case 'deploying':
                return <Loader2 class="size-3.5 animate-spin" aria-hidden />;
            case 'success':
                return <Check class="size-3.5" aria-hidden />;
            case 'error':
                return <X class="size-3.5" aria-hidden />;
            default:
                return <Zap class="size-3.5" aria-hidden />;
        }
    };

    const getLabel = () => {
        switch (status) {
            case 'deploying':
                return 'Déploiement...';
            case 'success':
                return 'Déployé !';
            case 'error':
                return 'Erreur';
            default:
                return 'Déployer Graft';
        }
    };

    return (
        <div class="flex flex-col gap-1.5">
            <button
                type="button"
                class={getButtonClass()}
                onClick={handleDeploy}
                disabled={status === 'deploying'}
                title="Déploie automatiquement Graft context graph sur tous les repos de l'équipe"
            >
                {getIcon()}
                {getLabel()}
            </button>
            
            {message && (
                <div
                    class={`text-xs px-2.5 py-1.5 rounded-lg ${
                        status === 'success'
                            ? 'bg-success/10 text-success'
                            : 'bg-error/10 text-error'
                    }`}
                >
                    {message}
                </div>
            )}
        </div>
    );
}
