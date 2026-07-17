import { LoaderCircle, RefreshCw } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
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
    const settingsQuery = useApiQuery(
        serverUuid && activeSection === 'overview' ? `server-settings:${serverUuid}` : null,
        () => domainApi.serverSettings(serverUuid!),
    );
    const resource = server.data?.data;
    const [wildcardDomain, setWildcardDomain] = useState('');
    const [savingWildcard, setSavingWildcard] = useState(false);
    const [wildcardError, setWildcardError] = useState<string | null>(null);
    const [wildcardSuccess, setWildcardSuccess] = useState<string | null>(null);

    useEffect(() => {
        setWildcardDomain(settingsQuery.data?.data.wildcard_domain ?? '');
    }, [settingsQuery.data?.data.wildcard_domain]);

    const saveWildcard = async () => {
        if (!serverUuid) {
            return;
        }

        setSavingWildcard(true);
        setWildcardError(null);
        setWildcardSuccess(null);

        try {
            const response = await domainApi.updateServerSettings(serverUuid, {
                wildcard_domain: wildcardDomain.trim() || null,
            });
            setWildcardDomain(response.data.wildcard_domain ?? '');
            setWildcardSuccess('Wildcard domain enregistré.');
            await Promise.all([server.reload({ silent: true }), settingsQuery.reload({ silent: true })]);
        } catch (error) {
            setWildcardError(error instanceof Error ? error.message : 'Impossible d’enregistrer le wildcard.');
        } finally {
            setSavingWildcard(false);
        }
    };

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
                                    {
                                        label: 'Wildcard domain',
                                        value: typeof resource.configuration.wildcard_domain === 'string'
                                            ? resource.configuration.wildcard_domain
                                            : 'Non configuré',
                                    },
                                ]}
                                />

                                <div class="grid gap-3 rounded-xl border border-base-300/60 bg-base-200/20 p-4">
                                    <div>
                                        <p class="text-sm font-semibold">Wildcard Domain</p>
                                        <p class="text-xs text-base-content/55">
                                            Utilisé pour générer les URLs des nouvelles applications
                                            (ex. <span class="font-mono">https://apps.example.com</span>
                                            → <span class="font-mono">https://&#123;uuid&#125;.apps.example.com</span>).
                                            Ce n’est pas l’URL de l’instance DevForge.
                                        </p>
                                    </div>
                                    <DataState
                                        loading={settingsQuery.loading}
                                        error={settingsQuery.error}
                                        onRetry={() => void settingsQuery.reload()}
                                    >
                                        <label class="grid gap-2">
                                            <span class="text-xs font-medium uppercase tracking-wide text-base-content/45">
                                                URL wildcard
                                            </span>
                                            <input
                                                class="input input-bordered input-sm w-full font-mono"
                                                type="url"
                                                placeholder="https://apps.example.com"
                                                value={wildcardDomain}
                                                disabled={savingWildcard}
                                                onInput={(event) => setWildcardDomain((event.target as HTMLInputElement).value)}
                                            />
                                        </label>
                                        <button
                                            class="btn btn-primary btn-sm w-fit rounded-full"
                                            type="button"
                                            disabled={savingWildcard}
                                            onClick={() => void saveWildcard()}
                                        >
                                            {savingWildcard
                                                ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                                : null}
                                            Enregistrer le wildcard
                                        </button>
                                        {wildcardSuccess && <p class="text-sm text-success">{wildcardSuccess}</p>}
                                        {wildcardError && <p class="text-sm text-error" role="alert">{wildcardError}</p>}
                                    </DataState>
                                </div>
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
