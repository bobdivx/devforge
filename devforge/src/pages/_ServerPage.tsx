import { RefreshCw } from 'lucide-preact';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { DataState } from '../components/ui/DataState';
import { ResourceStatusIcon } from '../components/ui/ResourceStatusIcon';
import { Tabs } from '../components/ui/Tabs';
import { LegacyEditBanner, SettingsDetailList } from '../components/settings/SettingsPanels';
import { ServerFileExplorer } from '../components/servers/ServerFileExplorer';
import { domainApi } from '../lib/domain-api';
import { resourceStatusInput } from '../lib/resource-status';
import {
    extractServerUuid,
    parseServerSection,
    serverLegacyPath,
    serverSections,
    type ServerSectionId,
} from '../lib/server-sections';
import { useApiQuery } from '../lib/use-api-query';
import { navigateTo } from '../lib/use-navigate';

type ServerPageProps = {
    path: string;
    legacyBaseUrl?: string;
};

export function ServerPage({ path, legacyBaseUrl = '' }: ServerPageProps) {
    const serverUuid = extractServerUuid(path);
    const activeSection = parseServerSection(path);
    const sectionMeta = serverSections.find(({ id }) => id === activeSection) ?? serverSections[0];

    const server = useApiQuery(
        serverUuid ? `core:servers:${serverUuid}` : null,
        () => domainApi.coreResource('servers', serverUuid!),
    );
    const resource = server.data?.data;

    if (!serverUuid) {
        return (
            <Card title="Serveur introuvable">
                <p class="text-sm text-base-content/65">UUID serveur manquant dans l’URL.</p>
            </Card>
        );
    }

    return (
        <div class="grid gap-5">
            <PageHeader
                title={resource?.name ?? 'Serveur'}
                description={sectionMeta.description}
            />
            <Tabs
                items={serverSections.map(({ id, label }) => ({ id, label }))}
                active={activeSection}
                onChange={(sectionId) => navigateTo(serverLegacyPath(serverUuid, sectionId as ServerSectionId))}
            />
            {activeSection === 'overview' ? (
                <Card title="Vue d’ensemble">
                    <div class="card-toolbar mb-3">
                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => void server.reload()}>
                            <RefreshCw class="size-3.5" aria-hidden />
                            Actualiser
                        </button>
                    </div>
                    <DataState loading={server.loading} error={server.error} onRetry={() => void server.reload()}>
                        {resource && (
                            <div class="grid gap-4">
                                <div class="flex items-center justify-between gap-3">
                                    <div>
                                        <p class="text-sm font-semibold">{resource.name}</p>
                                        <p class="font-mono text-[11px] text-base-content/45">{resource.uuid}</p>
                                    </div>
                                    <ResourceStatusIcon status={resourceStatusInput(resource)} />
                                </div>
                                {resource.description && (
                                    <p class="text-sm text-base-content/60">{resource.description}</p>
                                )}
                                <SettingsDetailList items={[
                                    { label: 'Joignable', value: typeof resource.status === 'object' && resource.status.reachable ? 'Oui' : 'Non' },
                                    { label: 'Utilisable', value: typeof resource.status === 'object' && resource.status.usable ? 'Oui' : 'Non' },
                                    { label: 'Validation', value: typeof resource.status === 'object' && resource.status.validating ? 'En cours' : 'Terminée' },
                                    { label: 'Build server', value: resource.configuration.build_server ? 'Oui' : 'Non' },
                                    { label: 'Swarm manager', value: resource.configuration.swarm_manager ? 'Oui' : 'Non' },
                                    { label: 'Métriques', value: resource.configuration.metrics_enabled ? 'Activées' : 'Désactivées' },
                                    { label: 'Terminal', value: resource.configuration.terminal_enabled ? 'Activé' : 'Désactivé' },
                                ]}
                                />
                            </div>
                        )}
                    </DataState>
                </Card>
            ) : activeSection === 'files' ? (
                <ServerFileExplorer
                    serverUuid={serverUuid}
                    terminalEnabled={resource?.configuration?.terminal_enabled !== false}
                />
            ) : (
                <LegacyEditBanner
                    legacyBaseUrl={legacyBaseUrl}
                    legacyPath={serverLegacyPath(serverUuid, activeSection)}
                    title={sectionMeta.label}
                    description={`La section « ${sectionMeta.label} » est encore gérée dans Coolify.`}
                />
            )}
        </div>
    );
}
