import { Eye, Play, RefreshCw, Rocket, RotateCw, Square, Wrench } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { domainApi, type CoreAction, type CoreResource } from '../../lib/domain-api';
import { resolveCoreResourceActions } from '../../lib/core-resource-actions';
import { resourceStatusInput } from '../../lib/resource-status';
import { useApiQuery } from '../../lib/use-api-query';
import { ActionToolbar } from '../ui/ActionToolbar';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DataState } from '../ui/DataState';
import { ResourceStatusIcon } from '../ui/ResourceStatusIcon';
import { StatusBadge } from '../ui/StatusBadge';

const actionLabels: Record<CoreAction, string> = {
    start: 'Démarrer',
    stop: 'Arrêter',
    restart: 'Redémarrer',
    deploy: 'Déployer',
};

const actionIcons = {
    start: Play,
    stop: Square,
    restart: RotateCw,
    deploy: Rocket,
};

type ServiceDetailPanelProps = {
    uuid: string;
    canAct: boolean;
    onClose: () => void;
    onChanged: () => Promise<void>;
};

function configurationEntries(resource: CoreResource): Array<[string, string]> {
    return Object.entries(resource.configuration)
        .slice(0, 12)
        .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')]);
}

export function ServiceDetailPanel({ uuid, canAct, onClose, onChanged }: ServiceDetailPanelProps) {
    const query = useApiQuery(`core:services:${uuid}`, () => domainApi.coreResource('services', uuid));
    const [acting, setActing] = useState<CoreAction | null>(null);
    const [pendingAction, setPendingAction] = useState<CoreAction | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const resource = query.data?.data;

    const runAction = async (action: CoreAction) => {
        if (!resource) {
            return;
        }

        setActing(action);
        setActionError(null);
        try {
            await domainApi.coreAction('services', resource.uuid, action);
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
        <div class="grid gap-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <button class="btn btn-ghost btn-sm w-fit" type="button" onClick={onClose}>
                    ← Retour aux services
                </button>
                <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                    <RefreshCw class="size-3.5" aria-hidden />
                    Actualiser
                </button>
            </div>

            <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                {resource && (
                    <div class="grid gap-4 rounded-2xl border border-base-300/70 bg-base-100 p-4 shadow-sm">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <div class="flex min-w-0 items-start gap-3">
                                <div class="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                    <Wrench class="size-5" aria-hidden />
                                </div>
                                <div class="min-w-0">
                                    <h2 class="truncate text-base font-semibold">{resource.name}</h2>
                                    <p class="font-mono text-[11px] text-base-content/45">{resource.uuid}</p>
                                    {resource.description && (
                                        <p class="mt-1 text-sm text-base-content/60">{resource.description}</p>
                                    )}
                                </div>
                            </div>
                            <ResourceStatusIcon status={resourceStatusInput(resource)} />
                        </div>

                        <div class="flex flex-wrap gap-2">
                            <StatusBadge label="Service" />
                            {resource.engine && <StatusBadge label={resource.engine} tone="neutral" />}
                        </div>

                        {configurationEntries(resource).length > 0 && (
                            <dl class="grid gap-2 rounded-xl border border-base-300/60 p-3 text-xs">
                                {configurationEntries(resource).map(([key, value]) => (
                                    <div class="grid gap-1 sm:grid-cols-[9rem_1fr] sm:gap-3" key={key}>
                                        <dt class="text-base-content/50">{key}</dt>
                                        <dd class="min-w-0 break-all font-mono">{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        )}

                        {actionError && <p class="text-xs text-error" role="alert">{actionError}</p>}

                        <ActionToolbar>
                            {canAct && resolveCoreResourceActions(resource).map((action) => {
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
                            <span class="inline-flex items-center gap-1 text-xs text-base-content/45 sm:ms-auto">
                                <Eye class="size-3.5" aria-hidden />
                                Actions core DevForge
                            </span>
                        </ActionToolbar>
                    </div>
                )}
            </DataState>

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
        </div>
    );
}
