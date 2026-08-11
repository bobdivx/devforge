import { LoaderCircle, Save, ScanSearch, Settings2 } from 'lucide-preact';
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
    detected_framework: string | null;
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
        detected_framework: data.detected_framework ?? null,
        health_check_enabled: data.health_check_enabled,
        health_check_path: data.health_check_path ?? '/',
        health_check_port: data.health_check_port ?? '',
    };
}

function serverSyncKey(data: ApplicationRuntimeSettings): string {
    return [
        data.build_pack,
        data.is_static,
        data.start_command,
        data.install_command,
        data.build_command,
        data.ports_exposes,
        data.base_directory,
        data.publish_directory,
        data.detected_framework,
        data.health_check_enabled,
        data.health_check_path,
        data.health_check_port,
    ].join('|');
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
    const [detecting, setDetecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [detectHints, setDetectHints] = useState<string[]>([]);

    const serverKey = data ? serverSyncKey(data) : null;

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

    const detect = async () => {
        if (!draft) {
            return;
        }

        setDetecting(true);
        setError(null);
        setSuccess(null);
        setDetectHints([]);

        try {
            const response = await domainApi.detectApplicationRuntimeSettings(applicationUuid);
            const detection = response.data;
            if (!detection.available) {
                setError(detection.reason ?? 'Détection impossible.');
                return;
            }

            const suggestions = detection.suggestions ?? {};
            setDraft((current) => {
                if (!current) {
                    return current;
                }
                return {
                    ...current,
                    is_static: typeof suggestions.is_static === 'boolean'
                        ? suggestions.is_static
                        : current.is_static,
                    ports_exposes: suggestions.ports_exposes ?? current.ports_exposes,
                    publish_directory: suggestions.publish_directory ?? current.publish_directory,
                    base_directory: suggestions.base_directory ?? current.base_directory,
                    start_command: suggestions.start_command ?? current.start_command,
                    build_command: suggestions.build_command ?? current.build_command,
                    install_command: suggestions.install_command ?? current.install_command,
                    health_check_enabled: typeof suggestions.health_check_enabled === 'boolean'
                        ? suggestions.health_check_enabled
                        : current.health_check_enabled,
                    health_check_path: suggestions.health_check_path ?? current.health_check_path,
                    health_check_port: suggestions.health_check_port ?? current.health_check_port,
                    detected_framework: suggestions.framework ?? current.detected_framework,
                };
            });
            setDetectHints(detection.reasons ?? []);
            setSuccess('Suggestions appliquées au formulaire — enregistrez pour persister.');
        } catch {
            setError('Impossible de détecter les paramètres depuis le dépôt.');
        } finally {
            setDetecting(false);
        }
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
                detected_framework: draft.detected_framework,
                health_check_enabled: draft.health_check_enabled,
                health_check_path: draft.health_check_path.trim() || '/',
                health_check_port: draft.health_check_port.trim() || null,
                redeploy: true,
            });
            const next = toDraft(response.data);
            setDraft(next);
            setSyncedKey(serverSyncKey(response.data));
            setDetectHints([]);

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
    const busy = saving || detecting;

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
                                    class="btn btn-ghost btn-sm rounded-full"
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void detect()}
                                    title="Lire package.json, Astro, Dockerfile, nixpacks.toml…"
                                >
                                    {detecting ? (
                                        <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                    ) : (
                                        <ScanSearch class="size-3.5" aria-hidden />
                                    )}
                                    Auto-détecter
                                </button>
                                <button
                                    class="btn btn-primary btn-sm rounded-full"
                                    type="button"
                                    disabled={busy}
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
                                disabled={!canAct || busy}
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
                                disabled={!canAct || busy || !supportsStatic}
                                onChange={(event) => update('is_static', (event.target as HTMLInputElement).checked)}
                            />
                            <span>
                                <span class="font-medium">Site statique (nginx)</span>
                                <span class="mt-0.5 block text-xs text-base-content/50">
                                    Si activé, DevForge sert les fichiers via nginx au lieu de démarrer Node/SSR.
                                    Désactivez pour les apps Astro/Node (ex. macompta).
                                </span>
                            </span>
                        </label>

                        <div class="grid gap-4 md:grid-cols-2">
                            <label class="grid gap-1.5 text-sm">
                                <span class="text-base-content/55">Commande de démarrage</span>
                                <input
                                    class="input input-bordered input-sm"
                                    disabled={!canAct || busy}
                                    placeholder="npm run start"
                                    value={draft.start_command}
                                    onInput={(event) => update('start_command', (event.target as HTMLInputElement).value)}
                                />
                            </label>
                            <label class="grid gap-1.5 text-sm">
                                <span class="text-base-content/55">Ports exposés</span>
                                <input
                                    class="input input-bordered input-sm font-mono"
                                    disabled={!canAct || busy}
                                    placeholder="3000"
                                    value={draft.ports_exposes}
                                    onInput={(event) => update('ports_exposes', (event.target as HTMLInputElement).value)}
                                />
                            </label>
                            <label class="grid gap-1.5 text-sm">
                                <span class="text-base-content/55">Install</span>
                                <input
                                    class="input input-bordered input-sm"
                                    disabled={!canAct || busy}
                                    placeholder="npm ci"
                                    value={draft.install_command}
                                    onInput={(event) => update('install_command', (event.target as HTMLInputElement).value)}
                                />
                            </label>
                            <label class="grid gap-1.5 text-sm">
                                <span class="text-base-content/55">Build</span>
                                <input
                                    class="input input-bordered input-sm"
                                    disabled={!canAct || busy}
                                    placeholder="npm run build"
                                    value={draft.build_command}
                                    onInput={(event) => update('build_command', (event.target as HTMLInputElement).value)}
                                />
                            </label>
                            <label class="grid gap-1.5 text-sm">
                                <span class="text-base-content/55">Répertoire de base</span>
                                <input
                                    class="input input-bordered input-sm font-mono"
                                    disabled={!canAct || busy}
                                    value={draft.base_directory}
                                    onInput={(event) => update('base_directory', (event.target as HTMLInputElement).value)}
                                />
                            </label>
                            <label class="grid gap-1.5 text-sm">
                                <span class="text-base-content/55">Répertoire publié</span>
                                <input
                                    class="input input-bordered input-sm font-mono"
                                    disabled={!canAct || busy}
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
                                    disabled={!canAct || busy}
                                    onChange={(event) => update('health_check_enabled', (event.target as HTMLInputElement).checked)}
                                />
                                Healthcheck Docker
                            </label>
                            <div class="grid gap-4 md:grid-cols-2">
                                <label class="grid gap-1.5 text-sm">
                                    <span class="text-base-content/55">Chemin</span>
                                    <input
                                        class="input input-bordered input-sm font-mono"
                                        disabled={!canAct || busy || !draft.health_check_enabled}
                                        value={draft.health_check_path}
                                        onInput={(event) => update('health_check_path', (event.target as HTMLInputElement).value)}
                                    />
                                </label>
                                <label class="grid gap-1.5 text-sm">
                                    <span class="text-base-content/55">Port</span>
                                    <input
                                        class="input input-bordered input-sm font-mono"
                                        disabled={!canAct || busy || !draft.health_check_enabled}
                                        placeholder="3000"
                                        value={draft.health_check_port}
                                        onInput={(event) => update('health_check_port', (event.target as HTMLInputElement).value)}
                                    />
                                </label>
                            </div>
                        </div>

                        {detectHints.length > 0 && (
                            <ul class="list-inside list-disc text-xs text-base-content/55">
                                {detectHints.map((hint) => (
                                    <li key={hint}>{hint}</li>
                                ))}
                            </ul>
                        )}
                        {success && <p class="text-sm text-success">{success}</p>}
                        {error && <p class="text-sm text-error" role="alert">{error}</p>}
                    </div>
                </section>
            )}
        </DataState>
    );
}
