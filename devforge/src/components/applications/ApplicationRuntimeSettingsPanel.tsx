import { LoaderCircle, Save, Settings2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import {
    domainApi,
    type ApplicationRuntimeSettings,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type Props = {
    applicationUuid: string;
    canAct: boolean;
    onChanged?: () => Promise<void> | void;
    onRedeployQueued?: (deploymentUuid: string) => void;
};

const buildPackOptions = [
    { value: 'nixpacks', label: 'Nixpacks' },
    { value: 'railpack', label: 'Railpack' },
    { value: 'dockerfile', label: 'Dockerfile' },
    { value: 'dockercompose', label: 'Docker Compose' },
    { value: 'static', label: 'Static' },
    { value: 'dockerimage', label: 'Docker Image' },
];

type Draft = {
    build_pack: string;
    is_static: boolean;
    start_command: string;
    install_command: string;
    build_command: string;
    ports_exposes: string;
    base_directory: string;
    publish_directory: string;
    health_check_enabled: boolean;
    health_check_path: string;
    health_check_port: string;
};

function toDraft(data: ApplicationRuntimeSettings): Draft {
    return {
        build_pack: data.build_pack,
        is_static: data.is_static,
        start_command: data.start_command ?? '',
        install_command: data.install_command ?? '',
        build_command: data.build_command ?? '',
        ports_exposes: data.ports_exposes ?? '',
        base_directory: data.base_directory ?? '/',
        publish_directory: data.publish_directory ?? '/',
        health_check_enabled: data.health_check_enabled,
        health_check_path: data.health_check_path ?? '/',
        health_check_port: data.health_check_port ?? '',
    };
}

export function ApplicationRuntimeSettingsPanel({
    applicationUuid,
    canAct,
    onChanged,
    onRedeployQueued,
}: Props) {
    const query = useApiQuery(
        `application-runtime-settings:${applicationUuid}`,
        () => domainApi.applicationRuntimeSettings(applicationUuid),
    );
    const data = query.data?.data ?? null;

    const [draft, setDraft] = useState<Draft | null>(null);
    const [syncedKey, setSyncedKey] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const serverKey = data
        ? [
            data.build_pack,
            data.is_static,
            data.start_command,
            data.ports_exposes,
            data.health_check_enabled,
            data.health_check_path,
            data.health_check_port,
        ].join('|')
        : null;

    useEffect(() => {
        if (!data || !serverKey || syncedKey === serverKey) {
            return;
        }
        setDraft(toDraft(data));
        setSyncedKey(serverKey);
    }, [data, serverKey, syncedKey]);

    const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
        setDraft((current) => (current ? { ...current, [key]: value } : current));
        setSuccess(null);
    };

    const save = async () => {
        if (!draft) {
            return;
        }

        setSaving(true);
        setError(null);
        setSuccess(null);

        try {
            const response = await domainApi.updateApplicationRuntimeSettings(applicationUuid, {
                build_pack: draft.build_pack,
                is_static: draft.is_static,
                start_command: draft.start_command.trim() || null,
                install_command: draft.install_command.trim() || null,
                build_command: draft.build_command.trim() || null,
                ports_exposes: draft.ports_exposes.trim(),
                base_directory: draft.base_directory.trim() || '/',
                publish_directory: draft.publish_directory.trim() || '/',
                health_check_enabled: draft.health_check_enabled,
                health_check_path: draft.health_check_path.trim() || '/',
                health_check_port: draft.health_check_port.trim() || null,
                redeploy: true,
            });
            const next = toDraft(response.data);
            setDraft(next);
            setSyncedKey([
                response.data.build_pack,
                response.data.is_static,
                response.data.start_command,
                response.data.ports_exposes,
                response.data.health_check_enabled,
                response.data.health_check_path,
                response.data.health_check_port,
            ].join('|'));

            const redeploy = response.meta?.redeploy;
            if (redeploy?.queued && redeploy.deployment_uuid) {
                setSuccess('Paramètres enregistrés — redéploiement lancé.');
                onRedeployQueued?.(redeploy.deployment_uuid);
            } else if (redeploy?.queued === false) {
                setSuccess('Paramètres enregistrés (redéploiement ignoré : déjà en file).');
            } else {
                setSuccess('Paramètres enregistrés (aucun changement à redéployer).');
            }

            await query.reload({ silent: true });
            await onChanged?.();
        } catch {
            setError('Impossible d’enregistrer les paramètres.');
        } finally {
            setSaving(false);
        }
    };

    const supportsStatic = draft
        ? ['nixpacks', 'railpack'].includes(draft.build_pack)
        : false;

    return (
        <DataState loading={query.loading && !data} error={query.error} onRetry={() => void query.reload()}>
            {draft && data && (
                <section class="min-w-0 overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
                    <div class="toolbar-row border-b border-base-300/70 px-4 py-4 sm:px-5">
                        <div class="min-w-0">
                            <p class="inline-flex items-center gap-2 text-sm font-semibold">
                                <Settings2 class="size-4 text-base-content/45" aria-hidden />
                                Paramètres de build & runtime
                            </p>
                            <p class="text-xs text-base-content/50">
                                Site statique, commandes, ports et healthcheck Docker
                            </p>
                        </div>
                        {canAct && (
                            <ActionToolbar>
                                <button
                                    class="btn btn-primary btn-sm rounded-full"
                                    type="button"
                                    disabled={saving}
                                    onClick={() => void save()}
                                >
                                    {saving ? (
                                        <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                    ) : (
                                        <Save class="size-3.5" aria-hidden />
                                    )}
                                    Enregistrer
                                </button>
                            </ActionToolbar>
                        )}
                    </div>

                    <div class="grid gap-5 p-4 sm:p-5">
                        <label class="grid gap-1.5 text-sm">
                            <span class="text-base-content/55">Build pack</span>
                            <select
                                class="select select-bordered select-sm w-full max-w-md"
                                disabled={!canAct || saving}
                                value={draft.build_pack}
                                onChange={(event) => {
                                    const value = (event.target as HTMLSelectElement).value;
                                    update('build_pack', value);
                                    if (!['nixpacks', 'railpack'].includes(value)) {
                                        update('is_static', false);
                                    }
                                    if (value === 'static') {
                                        update('is_static', true);
                                        update('ports_exposes', '80');
                                    }
                                }}
                            >
                                {buildPackOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>

                        <label class={`inline-flex items-center gap-3 text-sm ${supportsStatic ? '' : 'opacity-60'}`}>
                            <input
                                type="checkbox"
                                class="toggle toggle-sm toggle-primary"
                                checked={draft.is_static}
                                disabled={!canAct || saving || !supportsStatic}
                                onChange={(event) => update('is_static', (event.target as HTMLInputElement).checked)}
                            />
                            <span>
                                <span class="font-medium">Site statique (nginx)</span>
                                <span class="mt-0.5 block text-xs text-base-content/50">
                                    Si activé, Coolify sert les fichiers via nginx au lieu de démarrer Node/SSR.
                                    Désactivez pour les apps Astro/Node (ex. macompta).
                                </span>
                            </span>
                        </label>

                        <div class="grid gap-4 md:grid-cols-2">
                            <label class="grid gap-1.5 text-sm">
                                <span class="text-base-content/55">Commande de démarrage</span>
                                <input
                                    class="input input-bordered input-sm"
                                    disabled={!canAct || saving}
                                    placeholder="npm run start"
                                    value={draft.start_command}
                                    onInput={(event) => update('start_command', (event.target as HTMLInputElement).value)}
                                />
                            </label>
                            <label class="grid gap-1.5 text-sm">
                                <span class="text-base-content/55">Ports exposés</span>
                                <input
                                    class="input input-bordered input-sm font-mono"
                                    disabled={!canAct || saving}
                                    placeholder="3000"
                                    value={draft.ports_exposes}
                                    onInput={(event) => update('ports_exposes', (event.target as HTMLInputElement).value)}
                                />
                            </label>
                            <label class="grid gap-1.5 text-sm">
                                <span class="text-base-content/55">Install</span>
                                <input
                                    class="input input-bordered input-sm"
                                    disabled={!canAct || saving}
                                    placeholder="npm ci"
                                    value={draft.install_command}
                                    onInput={(event) => update('install_command', (event.target as HTMLInputElement).value)}
                                />
                            </label>
                            <label class="grid gap-1.5 text-sm">
                                <span class="text-base-content/55">Build</span>
                                <input
                                    class="input input-bordered input-sm"
                                    disabled={!canAct || saving}
                                    placeholder="npm run build"
                                    value={draft.build_command}
                                    onInput={(event) => update('build_command', (event.target as HTMLInputElement).value)}
                                />
                            </label>
                            <label class="grid gap-1.5 text-sm">
                                <span class="text-base-content/55">Répertoire de base</span>
                                <input
                                    class="input input-bordered input-sm font-mono"
                                    disabled={!canAct || saving}
                                    value={draft.base_directory}
                                    onInput={(event) => update('base_directory', (event.target as HTMLInputElement).value)}
                                />
                            </label>
                            <label class="grid gap-1.5 text-sm">
                                <span class="text-base-content/55">Répertoire publié</span>
                                <input
                                    class="input input-bordered input-sm font-mono"
                                    disabled={!canAct || saving}
                                    value={draft.publish_directory}
                                    onInput={(event) => update('publish_directory', (event.target as HTMLInputElement).value)}
                                />
                            </label>
                        </div>

                        <div class="rounded-xl border border-base-300/70 p-4">
                            <label class="mb-3 inline-flex items-center gap-3 text-sm">
                                <input
                                    type="checkbox"
                                    class="toggle toggle-sm toggle-primary"
                                    checked={draft.health_check_enabled}
                                    disabled={!canAct || saving}
                                    onChange={(event) => update('health_check_enabled', (event.target as HTMLInputElement).checked)}
                                />
                                Healthcheck Docker
                            </label>
                            <div class="grid gap-4 md:grid-cols-2">
                                <label class="grid gap-1.5 text-sm">
                                    <span class="text-base-content/55">Chemin</span>
                                    <input
                                        class="input input-bordered input-sm font-mono"
                                        disabled={!canAct || saving || !draft.health_check_enabled}
                                        value={draft.health_check_path}
                                        onInput={(event) => update('health_check_path', (event.target as HTMLInputElement).value)}
                                    />
                                </label>
                                <label class="grid gap-1.5 text-sm">
                                    <span class="text-base-content/55">Port</span>
                                    <input
                                        class="input input-bordered input-sm font-mono"
                                        disabled={!canAct || saving || !draft.health_check_enabled}
                                        placeholder="3000"
                                        value={draft.health_check_port}
                                        onInput={(event) => update('health_check_port', (event.target as HTMLInputElement).value)}
                                    />
                                </label>
                            </div>
                        </div>

                        {success && <p class="text-sm text-success">{success}</p>}
                        {error && <p class="text-sm text-error" role="alert">{error}</p>}
                    </div>
                </section>
            )}
        </DataState>
    );
}
