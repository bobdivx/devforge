import { Settings2, LoaderCircle, Save } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { domainApi, type ApplicationAdvancedSettings } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type Props = {
    applicationUuid: string;
    canAct: boolean;
};

type Draft = {
    disable_build_cache: boolean;
    inject_build_args_to_dockerfile: boolean;
    include_source_commit_in_build: boolean;
    skip_puppeteer_browser_download: boolean;
    is_consistent_container_name_enabled: boolean;
    is_auto_deploy_enabled: boolean;
    is_image_auto_update_enabled: boolean;
    is_git_submodules_enabled: boolean;
    is_git_lfs_enabled: boolean;
    is_git_shallow_clone_enabled: boolean;
    is_pr_deployments_public_enabled: boolean;
    is_force_https_enabled: boolean;
    is_gzip_enabled: boolean;
    is_stripprefix_enabled: boolean;
    is_log_drain_enabled: boolean;
    connect_to_docker_network: boolean;
    stop_grace_period: string;
    max_restart_count: number;
};

function toDraft(data: ApplicationAdvancedSettings): Draft {
    return {
        disable_build_cache: data.disable_build_cache,
        inject_build_args_to_dockerfile: data.inject_build_args_to_dockerfile,
        include_source_commit_in_build: data.include_source_commit_in_build,
        skip_puppeteer_browser_download: data.skip_puppeteer_browser_download,
        is_consistent_container_name_enabled: data.is_consistent_container_name_enabled,
        is_auto_deploy_enabled: data.is_auto_deploy_enabled,
        is_image_auto_update_enabled: data.is_image_auto_update_enabled,
        is_git_submodules_enabled: data.is_git_submodules_enabled,
        is_git_lfs_enabled: data.is_git_lfs_enabled,
        is_git_shallow_clone_enabled: data.is_git_shallow_clone_enabled,
        is_pr_deployments_public_enabled: data.is_pr_deployments_public_enabled,
        is_force_https_enabled: data.is_force_https_enabled,
        is_gzip_enabled: data.is_gzip_enabled,
        is_stripprefix_enabled: data.is_stripprefix_enabled,
        is_log_drain_enabled: data.is_log_drain_enabled,
        connect_to_docker_network: data.connect_to_docker_network,
        stop_grace_period: data.stop_grace_period !== null ? String(data.stop_grace_period) : '',
        max_restart_count: data.max_restart_count,
    };
}

type ToggleField = {
    key: keyof Draft;
    label: string;
    help?: string;
    visible?: boolean;
};

function ToggleRow({
    field,
    checked,
    disabled,
    onChange,
}: {
    field: ToggleField;
    checked: boolean;
    disabled: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label class="flex items-start gap-3 rounded-xl border border-base-300/60 bg-base-200/30 px-4 py-3">
            <input
                type="checkbox"
                class="checkbox checkbox-sm mt-0.5"
                checked={checked}
                disabled={disabled}
                onChange={(event) => onChange((event.target as HTMLInputElement).checked)}
            />
            <span class="min-w-0">
                <span class="block text-sm font-medium">{field.label}</span>
                {field.help && <span class="mt-0.5 block text-xs text-base-content/50">{field.help}</span>}
            </span>
        </label>
    );
}

export function ApplicationAdvancedSettingsPanel({ applicationUuid, canAct }: Props) {
    const query = useApiQuery(
        `application-advanced:${applicationUuid}`,
        () => domainApi.applicationAdvancedSettings(applicationUuid),
    );
    const data = query.data?.data;
    const [draft, setDraft] = useState<Draft | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (data) {
            setDraft(toDraft(data));
            setError(null);
        }
    }, [data]);

    const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
        setDraft((current) => (current ? { ...current, [key]: value } : current));
    };

    const save = async () => {
        if (!draft || !canAct) {
            return;
        }

        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            const stopGrace = draft.stop_grace_period.trim();
            const response = await domainApi.updateApplicationAdvancedSettings(applicationUuid, {
                disable_build_cache: draft.disable_build_cache,
                inject_build_args_to_dockerfile: draft.inject_build_args_to_dockerfile,
                include_source_commit_in_build: draft.include_source_commit_in_build,
                skip_puppeteer_browser_download: draft.skip_puppeteer_browser_download,
                is_consistent_container_name_enabled: draft.is_consistent_container_name_enabled,
                is_auto_deploy_enabled: draft.is_auto_deploy_enabled,
                is_image_auto_update_enabled: draft.is_image_auto_update_enabled,
                is_git_submodules_enabled: draft.is_git_submodules_enabled,
                is_git_lfs_enabled: draft.is_git_lfs_enabled,
                is_git_shallow_clone_enabled: draft.is_git_shallow_clone_enabled,
                is_pr_deployments_public_enabled: draft.is_pr_deployments_public_enabled,
                is_force_https_enabled: draft.is_force_https_enabled,
                is_gzip_enabled: draft.is_gzip_enabled,
                is_stripprefix_enabled: draft.is_stripprefix_enabled,
                is_log_drain_enabled: draft.is_log_drain_enabled,
                connect_to_docker_network: draft.connect_to_docker_network,
                stop_grace_period: stopGrace === '' ? null : Number(stopGrace),
                max_restart_count: draft.max_restart_count,
            });
            setDraft(toDraft(response.data));
            setMessage(response.data.message ?? 'Paramètres avancés mis à jour.');
            await query.reload();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    const caps = data?.capabilities;
    const buildToggles: ToggleField[] = [
        {
            key: 'disable_build_cache',
            label: 'Désactiver le cache de build',
            help: 'Force une reconstruction complète à chaque déploiement.',
        },
        {
            key: 'inject_build_args_to_dockerfile',
            label: 'Injecter les build args dans le Dockerfile',
        },
        {
            key: 'include_source_commit_in_build',
            label: 'Inclure le commit source dans le build',
        },
        {
            key: 'skip_puppeteer_browser_download',
            label: 'Ne pas télécharger Chrome (Puppeteer)',
            help: 'Activé par défaut. Évite l’échec npm ci sur Nixpacks. Décochez si l’app doit télécharger Chrome au build.',
        },
        {
            key: 'is_consistent_container_name_enabled',
            label: 'Nom de conteneur constant',
            help: 'Désactive le rolling update (nom fixe).',
        },
    ];

    const gitToggles: ToggleField[] = [
        {
            key: 'is_auto_deploy_enabled',
            label: 'Déploiement automatique',
            visible: caps?.git_based !== false,
        },
        {
            key: 'is_git_submodules_enabled',
            label: 'Git submodules',
            visible: caps?.git_based !== false,
        },
        {
            key: 'is_git_lfs_enabled',
            label: 'Git LFS',
            visible: caps?.git_based !== false,
        },
        {
            key: 'is_git_shallow_clone_enabled',
            label: 'Clone Git shallow',
            visible: caps?.git_based !== false,
        },
        {
            key: 'is_pr_deployments_public_enabled',
            label: 'Previews PR publiques',
        },
    ];

    const proxyToggles: ToggleField[] = [
        { key: 'is_force_https_enabled', label: 'Forcer HTTPS' },
        { key: 'is_gzip_enabled', label: 'Gzip' },
        { key: 'is_stripprefix_enabled', label: 'Strip prefix' },
    ];

    const opsToggles: ToggleField[] = [
        {
            key: 'is_image_auto_update_enabled',
            label: 'Auto-update image Docker Hub',
            help: 'Vérifie chaque heure le digest du tag configuré (Docker Hub / Quay) et redéploie si une nouvelle image est disponible. Tags flottants (latest/stable) recommandés ; pas de bump semver automatique.',
            visible: caps?.dockerimage === true,
        },
        {
            key: 'is_log_drain_enabled',
            label: 'Log drain',
            help: caps?.log_drain_server
                ? 'Envoie les logs vers le drain configuré sur le serveur.'
                : 'Indisponible : le log drain n’est pas activé sur le serveur.',
        },
        {
            key: 'connect_to_docker_network',
            label: 'Connecter au réseau Docker DevForge',
            help: 'Utile pour Docker Compose.',
            visible: caps?.dockercompose === true,
        },
    ];

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-5 py-4">
                <div>
                    <div class="flex items-center gap-2">
                        <Settings2 class="size-4 text-base-content/45" aria-hidden />
                        <p class="text-sm font-semibold">Paramètres avancés</p>
                    </div>
                    <p class="text-xs text-base-content/50">
                        Build, Git, proxy et options d’exploitation
                    </p>
                </div>
                <ActionToolbar>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        Actualiser
                    </button>
                    {canAct && (
                        <button
                            class="btn btn-primary btn-sm"
                            type="button"
                            disabled={saving || !draft}
                            onClick={() => void save()}
                        >
                            {saving
                                ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                : <Save class="size-3.5" aria-hidden />}
                            Enregistrer
                        </button>
                    )}
                </ActionToolbar>
            </div>

            <div class="grid gap-5 p-5">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {draft && (
                        <>
                            {message && (
                                <p class="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                                    {message}
                                </p>
                            )}
                            {error && (
                                <p class="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                                    {error}
                                </p>
                            )}

                            <div class="grid gap-2">
                                <p class="text-xs font-semibold uppercase tracking-wide text-base-content/45">Build</p>
                                <div class="grid gap-2 sm:grid-cols-2">
                                    {buildToggles.map((field) => (
                                        <ToggleRow
                                            key={field.key}
                                            field={field}
                                            checked={Boolean(draft[field.key])}
                                            disabled={!canAct || saving}
                                            onChange={(value) => update(field.key, value)}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div class="grid gap-2">
                                <p class="text-xs font-semibold uppercase tracking-wide text-base-content/45">Git & deploy</p>
                                <div class="grid gap-2 sm:grid-cols-2">
                                    {gitToggles.filter((field) => field.visible !== false).map((field) => (
                                        <ToggleRow
                                            key={field.key}
                                            field={field}
                                            checked={Boolean(draft[field.key])}
                                            disabled={!canAct || saving}
                                            onChange={(value) => update(field.key, value)}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div class="grid gap-2">
                                <p class="text-xs font-semibold uppercase tracking-wide text-base-content/45">Proxy</p>
                                <div class="grid gap-2 sm:grid-cols-2">
                                    {proxyToggles.map((field) => (
                                        <ToggleRow
                                            key={field.key}
                                            field={field}
                                            checked={Boolean(draft[field.key])}
                                            disabled={!canAct || saving}
                                            onChange={(value) => update(field.key, value)}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div class="grid gap-2">
                                <p class="text-xs font-semibold uppercase tracking-wide text-base-content/45">Exploitation</p>
                                <div class="grid gap-2 sm:grid-cols-2">
                                    {opsToggles.filter((field) => field.visible !== false).map((field) => (
                                        <ToggleRow
                                            key={field.key}
                                            field={field}
                                            checked={Boolean(draft[field.key])}
                                            disabled={
                                                !canAct
                                                || saving
                                                || (field.key === 'is_log_drain_enabled' && !caps?.log_drain_server && !draft.is_log_drain_enabled)
                                            }
                                            onChange={(value) => update(field.key, value)}
                                        />
                                    ))}
                                </div>
                                <div class="grid gap-3 sm:grid-cols-2">
                                    <label class="grid gap-1.5 text-sm">
                                        <span class="font-medium">Stop grace period (s)</span>
                                        <input
                                            class="input input-bordered input-sm"
                                            type="number"
                                            min={1}
                                            max={3600}
                                            disabled={!canAct || saving}
                                            value={draft.stop_grace_period}
                                            placeholder="Défaut"
                                            onInput={(event) => update('stop_grace_period', (event.target as HTMLInputElement).value)}
                                        />
                                    </label>
                                    <label class="grid gap-1.5 text-sm">
                                        <span class="font-medium">Max restart count</span>
                                        <input
                                            class="input input-bordered input-sm"
                                            type="number"
                                            min={0}
                                            disabled={!canAct || saving}
                                            value={draft.max_restart_count}
                                            onInput={(event) => update('max_restart_count', Number((event.target as HTMLInputElement).value) || 0)}
                                        />
                                    </label>
                                </div>
                            </div>
                        </>
                    )}
                </DataState>
            </div>
        </section>
    );
}
