import { RefreshCw } from 'lucide-preact';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { DataState } from '../components/ui/DataState';
import { LegacyEditBanner } from '../components/settings/SettingsPanels';
import { domainApi } from '../lib/domain-api';
import { useApiQuery } from '../lib/use-api-query';

type TerminalPageProps = {
    legacyBaseUrl?: string;
    canAccess: boolean;
};

export function TerminalPage({ legacyBaseUrl = '', canAccess }: TerminalPageProps) {
    const config = useApiQuery(canAccess ? 'terminal-config' : null, () => domainApi.terminalConfig());

    return (
        <div class="grid gap-5">
            <PageHeader
                title="Terminal"
                description="Connexion aux serveurs et conteneurs de l’équipe active."
            />
            {!canAccess && (
                <Card title="Accès refusé">
                    <p class="text-sm text-base-content/65">Votre rôle n’autorise pas l’accès au terminal.</p>
                </Card>
            )}
            {canAccess && (
                <>
                    <LegacyEditBanner
                        legacyBaseUrl={legacyBaseUrl}
                        legacyPath="/terminal"
                        description="Le terminal interactif complet est encore servi par Coolify. DevForge expose la configuration de connexion."
                    />
                    <Card title="Configuration">
                        <DataState loading={config.loading} error={config.error} onRetry={() => void config.reload()}>
                            {config.data && (
                                <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
                                    <dt class="text-base-content/45">WebSocket</dt>
                                    <dd class="font-mono text-xs">{config.data.data.websocket_url}</dd>
                                    <dt class="text-base-content/45">Serveurs</dt>
                                    <dd>{config.data.data.targets.length} accessible(s)</dd>
                                </dl>
                            )}
                        </DataState>
                        <button class="btn btn-ghost btn-sm mt-3" type="button" onClick={() => void config.reload()}>
                            <RefreshCw class="size-3.5" aria-hidden />
                            Actualiser
                        </button>
                    </Card>
                </>
            )}
        </div>
    );
}
