import { Play, RotateCw, Rocket, Square } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { ActionToolbar } from '../../components/ui/ActionToolbar';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataState } from '../../components/ui/DataState';
import { ResourceStatusIcon } from '../../components/ui/ResourceStatusIcon';
import { resourceStatusInput } from '../../lib/resource-status';
import { resolveCoreResourceActions } from '../../lib/core-resource-actions';
import type { BootstrapPermissions } from '../../lib/bootstrap';
import {
    domainApi,
    type ApplicationBootSequenceItem,
    type CoreAction,
    type CoreResource,
    type CoreResourceType,
} from '../../lib/domain-api';
import { parseApplicationTab, type ApplicationTabId } from '../../lib/application-tabs';
import {
    parseDatabaseTab,
    parseServiceTab,
    type DatabaseDetailTabId,
    type ServiceDetailTabId,
} from '../../lib/routes';
import { parseResourceStatus } from '../../lib/resource-status';
import { useApiQuery } from '../../lib/use-api-query';
import { sanitizeResourceUuid } from '../../lib/route-path';

export function bootPhaseForResource(
    resourceUuid: string,
    items: ApplicationBootSequenceItem[],
    bootActive: boolean,
): ApplicationBootSequenceItem['phase'] | null {
    if (!bootActive) {
        return null;
    }

    return items.find((item) => item.uuid === resourceUuid)?.phase ?? null;
}

export function bootCardClass(phase: ApplicationBootSequenceItem['phase'] | null): string {
    if (phase === null) {
        return '';
    }

    if (phase === 'waiting') {
        return 'application-boot-card application-boot-card--waiting';
    }

    if (phase === 'starting') {
        return 'application-boot-card application-boot-card--starting';
    }

    if (phase === 'running') {
        return 'application-boot-card application-boot-card--running';
    }

    if (phase === 'failed') {
        return 'application-boot-card application-boot-card--failed';
    }

    return 'application-boot-card';
}

export function readUuidDeepLink(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }

    return sanitizeResourceUuid(new URLSearchParams(window.location.search).get('uuid'));
}

export function readDatabaseDeepLink(): { uuid: string | null; tab: DatabaseDetailTabId } {
    if (typeof window === 'undefined') {
        return { uuid: null, tab: 'overview' };
    }

    const params = new URLSearchParams(window.location.search);

    return {
        uuid: sanitizeResourceUuid(params.get('uuid')),
        tab: parseDatabaseTab(params.get('tab')),
    };
}

export function readServiceDeepLink(): { uuid: string | null; tab: ServiceDetailTabId } {
    if (typeof window === 'undefined') {
        return { uuid: null, tab: 'overview' };
    }

    const params = new URLSearchParams(window.location.search);

    return {
        uuid: sanitizeResourceUuid(params.get('uuid')),
        tab: parseServiceTab(params.get('tab')),
    };
}

export function readApplicationTabDeepLink(): ApplicationTabId {
    if (typeof window === 'undefined') {
        return 'agents';
    }

    return parseApplicationTab(new URLSearchParams(window.location.search).get('tab'));
}

export type CoreResourcesPageProps = {
    type: CoreResourceType;
    permissions: BootstrapPermissions;
    embedded?: boolean;
    legacyBaseUrl?: string;
    initialResourceUuid?: string | null;
};

export const labels: Record<CoreResourceType, string> = {
    servers: 'Serveurs',
    applications: 'Applications',
    databases: 'Bases de données',
    services: 'Services',
};

export const descriptions: Record<CoreResourceType, string> = {
    servers: 'Hôtes SSH, proxy et destinations de déploiement.',
    applications: 'Santé, déploiements et accès rapide à vos apps.',
    databases: 'Instances, connexions et sauvegardes.',
    services: 'Stacks et services gérés.',
};

export const actionLabels: Record<CoreAction, string> = {
    start: 'Démarrer',
    stop: 'Arrêter',
    restart: 'Redémarrer',
    deploy: 'Déployer',
};

export const actionIcons = {
    start: Play,
    stop: Square,
    restart: RotateCw,
    deploy: Rocket,
};

export function databaseCardTitle(resource: CoreResource): string {
    const applications = resource.connected_applications ?? [];

    if (/^libsql-database-[a-z0-9]+$/i.test(resource.name) && applications.length > 0) {
        return applications.length === 1
            ? `Base de ${applications[0].application_name}`
            : applications.map((application) => application.application_name).join(', ');
    }

    if (applications.length === 0) {
        return 'Sans application';
    }

    return applications.map((application) => application.application_name).join(', ');
}

export function databaseCardSubtitle(resource: CoreResource): string {
    const engineLabel = resource.engine_label ?? resource.engine ?? 'Base de données';
    const status = parseResourceStatus(resource.status).shortLabel;

    return `${engineLabel} · ${status}`;
}

export function resourceSearchHaystack(resource: CoreResource, resourceType: CoreResourceType): string {
    const values = [resource.name, resource.uuid];

    if (resourceType === 'databases') {
        values.push(resource.engine ?? '', resource.engine_label ?? '');
        values.push(...(resource.connected_applications ?? []).map((application) => application.application_name));
    }

    return values.join(' ').toLowerCase();
}

export function ResourceDetail({ type, uuid, canAct, onClose, onChanged }: {
    type: CoreResourceType;
    uuid: string;
    canAct: boolean;
    onClose: () => void;
    onChanged: () => Promise<void>;
}) {
    const query = useApiQuery(`core:${type}:${uuid}`, () => domainApi.coreResource(type, uuid));
    const [acting, setActing] = useState<CoreAction | null>(null);
    const [pendingAction, setPendingAction] = useState<CoreAction | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const resource = query.data?.data;

    const runAction = async (action: CoreAction) => {
        if (!resource || type === 'servers') return;
        setActing(action);
        setActionError(null);
        try {
            await domainApi.coreAction(type, resource.uuid, action);
            await query.reload();
            await onChanged();
        } catch {
            setActionError(`L’action « ${actionLabels[action]} » a échoué.`);
        } finally {
            setActing(null);
            setPendingAction(null);
        }
    };

    return (
        <>
            <Card title="Détail de la ressource">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {resource && (
                        <div class="grid gap-3">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <p class="text-xs sm:text-sm font-semibold">{resource.name}</p>
                                    <p class="font-mono text-[11px] text-base-content/45">{resource.uuid}</p>
                                </div>
                                <ResourceStatusIcon status={resourceStatusInput(resource)} />
                            </div>
                            {resource.description && <p class="text-xs text-base-content/60">{resource.description}</p>}
                            {resource.engine && <p class="text-xs">Moteur : <span class="font-medium">{resource.engine}</span></p>}
                            {Object.keys(resource.configuration).length > 0 && (
                                <dl class="grid gap-1 rounded-sm border border-base-300 p-3 text-xs">
                                    {Object.entries(resource.configuration).slice(0, 8).map(([key, value]) => (
                                        <div class="grid grid-cols-[8rem_1fr] gap-2" key={key}>
                                            <dt class="text-base-content/50">{key}</dt>
                                            <dd class="truncate font-mono">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                                        </div>
                                    ))}
                                </dl>
                            )}
                            {actionError && <p class="text-xs text-error" role="alert">{actionError}</p>}
                            <ActionToolbar>
                                {canAct && type !== 'servers' && resolveCoreResourceActions(resource).map((action) => {
                                    const Icon = actionIcons[action];
                                    return (
                                        <button
                                            class="btn btn-sm"
                                            type="button"
                                            disabled={acting !== null}
                                            key={action}
                                            onClick={() => {
                                                if (['stop', 'restart', 'deploy'].includes(action)) {
                                                    setPendingAction(action);
                                                    return;
                                                }
                                                void runAction(action);
                                            }}
                                        >
                                            <Icon class="size-3.5" aria-hidden />
                                            {acting === action ? 'En cours…' : actionLabels[action]}
                                        </button>
                                    );
                                })}
                                <button class="btn btn-ghost btn-sm sm:ms-auto" type="button" onClick={onClose}>Fermer</button>
                            </ActionToolbar>
                        </div>
                    )}
                </DataState>
            </Card>

            {resource && pendingAction && (
                <ConfirmDialog
                    open
                    title={actionLabels[pendingAction]}
                    message={`Confirmer « ${actionLabels[pendingAction]} » sur « ${resource.name} » ?`}
                    tone="danger"
                    loading={acting === pendingAction}
                    onCancel={() => setPendingAction(null)}
                    onConfirm={() => void runAction(pendingAction)}
                />
            )}
        </>
    );
}
