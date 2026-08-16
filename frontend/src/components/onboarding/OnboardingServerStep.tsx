import { Server } from 'lucide-preact';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';

type OnboardingServerStepProps = {
    onContinue: () => void;
};

export function OnboardingServerStep({ onContinue }: OnboardingServerStepProps) {
    const query = useApiQuery('onboarding-servers', () => domainApi.coreResources('servers'));
    const servers = query.data?.data ?? [];

    return (
        <Card title="Premier serveur" eyebrow="Infrastructure">
            <p class="text-sm text-base-content/65">
                DevForge déploie sur un hôte Docker joignable en SSH. L’installation locale crée généralement le serveur
                localhost automatiquement.
            </p>
            <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                {servers.length === 0 ? (
                    <p class="mt-3 text-sm text-base-content/60">
                        Aucun serveur n’est encore visible. Vous pourrez en ajouter un depuis Réglages → Serveurs après
                        cette configuration.
                    </p>
                ) : (
                    <ul class="mt-3 divide-y divide-base-300/70">
                        {servers.map((server) => (
                            <li class="flex items-center gap-3 py-3" key={server.uuid}>
                                <Server class="size-4 text-primary" aria-hidden />
                                <div class="min-w-0 flex-1">
                                    <p class="truncate text-sm font-semibold">{server.name}</p>
                                    {server.description && (
                                        <p class="truncate text-xs text-base-content/50">{server.description}</p>
                                    )}
                                </div>
                                <StatusBadge label="Disponible" tone="success" />
                            </li>
                        ))}
                    </ul>
                )}
            </DataState>
            <div class="mt-4">
                <Button onClick={onContinue}>
                    {servers.length > 0 ? 'Continuer' : 'Continuer sans serveur'}
                </Button>
            </div>
        </Card>
    );
}
