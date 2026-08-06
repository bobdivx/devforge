import { useEffect, useMemo, useState } from 'preact/hooks';
import { Modal } from '../ui/Modal';
import {
    domainApi,
    type CoreResource,
    type GithubAppSummary,
    type GithubRepository,
    type GithubRunnerAuthMode,
    type GithubRunnerCreateInput,
} from '../../lib/domain-api';

type Props = {
    open: boolean;
    prefill?: CreateRunnerPrefill | null;
    onClose: () => void;
    onCreated: () => void;
};

export type CreateRunnerPrefill = {
    owner?: string;
    repo?: string;
    runner_name?: string;
    image?: string;
    container_name?: string;
    labels?: string;
    network_mode?: 'bridge' | 'host' | 'none';
};

type FormState = {
    auth_mode: GithubRunnerAuthMode;
    access_token: string;
    github_app_uuid: string;
    repository_id: number | '';
    owner: string;
    repo: string;
    server_uuid: string;
    runner_name: string;
    container_name: string;
    labels: string;
    image: string;
    network_mode: 'bridge' | 'host' | 'none';
    timezone: string;
    replace_existing: boolean;
    recreate: boolean;
    volumes: string;
    extra_env: string;
};

const defaultForm = (): FormState => ({
    auth_mode: 'registration',
    access_token: '',
    github_app_uuid: '',
    repository_id: '',
    owner: '',
    repo: '',
    server_uuid: '',
    runner_name: '',
    container_name: '',
    labels: 'self-hosted,devforge',
    image: 'myoung34/github-runner:latest',
    network_mode: 'bridge',
    timezone: 'Europe/Paris',
    replace_existing: true,
    recreate: false,
    volumes: '',
    extra_env: '',
});

const POPCORN_IMAGE_PRESETS: Array<{ label: string; image: string }> = [
    { label: 'Popcorn client', image: 'ghcr.io/bobdivx/popcorn-github-runner-client:latest' },
    { label: 'Popcorn server / tauri', image: 'ghcr.io/bobdivx/popcorn-github-runner-server:latest' },
    { label: 'myoung34 (générique)', image: 'myoung34/github-runner:latest' },
];

function parseExtraEnvLines(raw: string): Array<{ key: string; value: string }> {
    return raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const separator = line.indexOf('=');
            if (separator <= 0) {
                return null;
            }

            const key = line.slice(0, separator).trim().toUpperCase();
            const value = line.slice(separator + 1);

            if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
                return null;
            }

            return { key, value };
        })
        .filter((entry): entry is { key: string; value: string } => entry !== null);
}

export function CreateRunnerModal({ open, prefill = null, onClose, onCreated }: Props) {
    const [form, setForm] = useState<FormState>(defaultForm);
    const [githubApps, setGithubApps] = useState<GithubAppSummary[]>([]);
    const [repositories, setRepositories] = useState<GithubRepository[]>([]);
    const [servers, setServers] = useState<CoreResource[]>([]);
    const [repoSearch, setRepoSearch] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }

        setForm(defaultForm());
        setRepoSearch(prefill?.repo ?? '');
        setShowAdvanced(Boolean(prefill?.container_name || prefill?.network_mode));
        setError(null);
        setLoading(true);

        void Promise.all([
            domainApi.githubApps(),
            domainApi.coreResources('servers'),
        ])
            .then(([appsResponse, serversResponse]) => {
                const apps = appsResponse.data ?? [];
                const serverList = serversResponse.data ?? [];
                setGithubApps(apps);
                setServers(serverList);
                setForm((current) => ({
                    ...current,
                    auth_mode: apps.length > 0 ? 'registration' : 'pat',
                    github_app_uuid: apps[0]?.uuid ?? '',
                    server_uuid: serverList[0]?.uuid ?? '',
                    owner: prefill?.owner ?? '',
                    repo: prefill?.repo ?? '',
                    runner_name: prefill?.runner_name ?? '',
                    image: prefill?.image ?? current.image,
                    container_name: prefill?.container_name ?? '',
                    labels: prefill?.labels ?? current.labels,
                    network_mode: prefill?.network_mode ?? current.network_mode,
                }));
            })
            .catch((err) => {
                setError(err instanceof Error ? err.message : 'Chargement impossible.');
            })
            .finally(() => setLoading(false));
    }, [open, prefill]);

    useEffect(() => {
        if (!open || !form.github_app_uuid) {
            setRepositories([]);
            return;
        }

        let cancelled = false;
        setLoading(true);
        void domainApi.githubRepositories(form.github_app_uuid)
            .then((response) => {
                if (cancelled) {
                    return;
                }
                const repos = response.data ?? [];
                setRepositories(repos);

                const preferred = prefill?.owner && prefill?.repo
                    ? repos.find((repository) => repository.owner.toLowerCase() === prefill.owner!.toLowerCase()
                        && repository.name.toLowerCase() === prefill.repo!.toLowerCase())
                    : null;

                setForm((current) => ({
                    ...current,
                    repository_id: preferred?.id ?? '',
                    runner_name: current.runner_name || (preferred
                        ? `devforge-runner-${preferred.name}`.slice(0, 64)
                        : ''),
                }));
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Impossible de charger les dépôts.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [open, form.github_app_uuid, prefill?.owner, prefill?.repo]);

    const filteredRepos = useMemo(() => {
        const normalized = repoSearch.trim().toLowerCase();
        if (!normalized) {
            return repositories;
        }

        return repositories.filter((repository) => repository.full_name.toLowerCase().includes(normalized)
            || repository.name.toLowerCase().includes(normalized));
    }, [repositories, repoSearch]);

    const selectedRepo = useMemo(
        () => repositories.find((repository) => repository.id === form.repository_id) ?? null,
        [repositories, form.repository_id],
    );

    const useManualRepo = form.auth_mode === 'pat' && (githubApps.length === 0 || !form.github_app_uuid);

    useEffect(() => {
        if (!selectedRepo || useManualRepo) {
            return;
        }

        setForm((current) => {
            if (current.runner_name.trim() !== '') {
                return current;
            }

            return {
                ...current,
                runner_name: `devforge-runner-${selectedRepo.name}`.slice(0, 64),
            };
        });
    }, [selectedRepo?.id, useManualRepo]);

    const owner = useManualRepo
        ? form.owner.trim()
        : (selectedRepo?.owner ?? form.owner.trim());
    const repo = useManualRepo
        ? form.repo.trim()
        : (selectedRepo?.name ?? form.repo.trim());

    const canSubmit = Boolean(
        form.server_uuid
        && form.runner_name.trim()
        && owner
        && repo
        && (form.auth_mode === 'pat'
            ? form.access_token.trim()
            : form.github_app_uuid)
        && !submitting
        && !loading,
    );

    async function handleSubmit(event: Event) {
        event.preventDefault();
        if (!canSubmit) {
            return;
        }

        setSubmitting(true);
        setError(null);

        const volumes = form.volumes
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

        const extraEnv = parseExtraEnvLines(form.extra_env);

        const payload: GithubRunnerCreateInput = {
            auth_mode: form.auth_mode,
            access_token: form.auth_mode === 'pat' ? form.access_token.trim() : undefined,
            github_app_uuid: form.github_app_uuid || undefined,
            owner,
            repo,
            server_uuid: form.server_uuid,
            runner_name: form.runner_name.trim(),
            container_name: form.container_name.trim() || undefined,
            labels: form.labels.trim() || undefined,
            image: form.image.trim() || undefined,
            network_mode: form.network_mode,
            timezone: form.timezone.trim() || undefined,
            replace_existing: form.replace_existing,
            recreate: form.recreate,
            volumes: volumes.length > 0 ? volumes : undefined,
            extra_env: extraEnv.length > 0 ? extraEnv : undefined,
        };

        try {
            await domainApi.createGithubRunner(payload);
            onCreated();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Création impossible.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Modal
            open={open}
            title="Nouveau runner GitHub"
            onClose={onClose}
            footer={(
                <>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>Annuler</button>
                    <button class="btn btn-primary btn-sm" type="submit" form="create-runner-form" disabled={!canSubmit}>
                        {submitting && <span class="loading loading-spinner loading-xs" />}
                        Créer le runner
                    </button>
                </>
            )}
        >
            <form id="create-runner-form" class="grid gap-4" onSubmit={handleSubmit}>
                <fieldset class="grid gap-2">
                    <legend class="text-xs font-medium">Authentification</legend>
                    <label class="flex cursor-pointer items-start gap-2 rounded-xl border border-base-300/70 bg-base-200/20 px-3 py-2 text-xs">
                        <input
                            type="radio"
                            class="radio radio-sm mt-0.5"
                            name="runner-auth-mode"
                            checked={form.auth_mode === 'registration'}
                            disabled={githubApps.length === 0}
                            onChange={() => setForm((current) => ({
                                ...current,
                                auth_mode: 'registration',
                                access_token: '',
                            }))}
                        />
                        <span>
                            <span class="font-medium">Jeton d’enregistrement</span>
                            <span class="mt-0.5 block text-base-content/55">
                                Généré automatiquement via la GitHub App (courte durée, recommandé).
                            </span>
                        </span>
                    </label>
                    <label class="flex cursor-pointer items-start gap-2 rounded-xl border border-base-300/70 bg-base-200/20 px-3 py-2 text-xs">
                        <input
                            type="radio"
                            class="radio radio-sm mt-0.5"
                            name="runner-auth-mode"
                            checked={form.auth_mode === 'pat'}
                            onChange={() => setForm((current) => ({
                                ...current,
                                auth_mode: 'pat',
                            }))}
                        />
                        <span>
                            <span class="font-medium">Personal Access Token (PAT)</span>
                            <span class="mt-0.5 block text-base-content/55">
                                Comme un <code class="text-[11px]">ACCESS_TOKEN</code> CasaOS — le runner génère lui-même le jeton d’enregistrement.
                            </span>
                        </span>
                    </label>
                </fieldset>

                {form.auth_mode === 'pat' && (
                    <div class="grid gap-1.5">
                        <label class="text-xs font-medium" for="runner-access-token">ACCESS_TOKEN / PAT</label>
                        <input
                            id="runner-access-token"
                            type="password"
                            autoComplete="off"
                            class="input input-bordered input-sm w-full font-mono text-[11px]"
                            placeholder="ghp_… ou github_pat_…"
                            value={form.access_token}
                            onInput={(event) => setForm((current) => ({
                                ...current,
                                access_token: (event.target as HTMLInputElement).value,
                            }))}
                        />
                        <p class="text-[11px] text-base-content/50">
                            Permissions GitHub : accès au dépôt + gestion des self-hosted runners.
                        </p>
                    </div>
                )}

                {error && (
                    <p class="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
                )}

                {form.auth_mode === 'registration' && githubApps.length === 0 ? (
                    <p class="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                        Connectez une GitHub App, ou passez en mode PAT.
                    </p>
                ) : (
                    <>
                        {githubApps.length > 0 && (
                            <div class="grid gap-1.5">
                                <label class="text-xs font-medium" for="runner-github-app">GitHub App</label>
                                <select
                                    id="runner-github-app"
                                    class="select select-bordered select-sm w-full"
                                    value={form.github_app_uuid}
                                    onChange={(event) => setForm((current) => ({
                                        ...current,
                                        github_app_uuid: (event.target as HTMLSelectElement).value,
                                    }))}
                                >
                                    {form.auth_mode === 'pat' && (
                                        <option value="">Saisie manuelle du dépôt</option>
                                    )}
                                    {githubApps.map((app) => (
                                        <option key={app.uuid} value={app.uuid}>
                                            {app.display_name ?? app.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {useManualRepo ? (
                            <div class="grid gap-3 sm:grid-cols-2">
                                <div class="grid gap-1.5">
                                    <label class="text-xs font-medium" for="runner-owner">Owner</label>
                                    <input
                                        id="runner-owner"
                                        class="input input-bordered input-sm w-full font-mono"
                                        placeholder="bobdivx"
                                        value={form.owner}
                                        onInput={(event) => setForm((current) => ({
                                            ...current,
                                            owner: (event.target as HTMLInputElement).value,
                                        }))}
                                    />
                                </div>
                                <div class="grid gap-1.5">
                                    <label class="text-xs font-medium" for="runner-repo">Repo</label>
                                    <input
                                        id="runner-repo"
                                        class="input input-bordered input-sm w-full font-mono"
                                        placeholder="popcorn-client"
                                        value={form.repo}
                                        onInput={(event) => setForm((current) => ({
                                            ...current,
                                            repo: (event.target as HTMLInputElement).value,
                                        }))}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div class="grid gap-1.5">
                                <label class="text-xs font-medium" for="runner-repo-search">Dépôt</label>
                                <input
                                    id="runner-repo-search"
                                    class="input input-bordered input-sm w-full"
                                    placeholder="Rechercher un dépôt…"
                                    value={repoSearch}
                                    onInput={(event) => setRepoSearch((event.target as HTMLInputElement).value)}
                                />
                                <select
                                    class="select select-bordered select-sm w-full"
                                    value={form.repository_id}
                                    onChange={(event) => setForm((current) => ({
                                        ...current,
                                        repository_id: Number((event.target as HTMLSelectElement).value) || '',
                                        runner_name: '',
                                    }))}
                                >
                                    <option value="">Choisir un dépôt</option>
                                    {filteredRepos.map((repository) => (
                                        <option key={repository.id} value={repository.id}>{repository.full_name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="runner-server">Serveur</label>
                            <select
                                id="runner-server"
                                class="select select-bordered select-sm w-full"
                                value={form.server_uuid}
                                onChange={(event) => setForm((current) => ({
                                    ...current,
                                    server_uuid: (event.target as HTMLSelectElement).value,
                                }))}
                            >
                                {servers.map((server) => (
                                    <option key={server.uuid} value={server.uuid}>{server.name}</option>
                                ))}
                            </select>
                        </div>

                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="runner-name">Nom du runner</label>
                            <input
                                id="runner-name"
                                class="input input-bordered input-sm w-full font-mono"
                                value={form.runner_name}
                                onInput={(event) => setForm((current) => ({
                                    ...current,
                                    runner_name: (event.target as HTMLInputElement).value,
                                }))}
                            />
                        </div>

                        <div class="grid gap-3 sm:grid-cols-2">
                            <div class="grid gap-1.5">
                                <label class="text-xs font-medium" for="runner-labels">Labels</label>
                                <input
                                    id="runner-labels"
                                    class="input input-bordered input-sm w-full"
                                    value={form.labels}
                                    onInput={(event) => setForm((current) => ({
                                        ...current,
                                        labels: (event.target as HTMLInputElement).value,
                                    }))}
                                />
                            </div>
                            <div class="grid gap-1.5">
                                <label class="text-xs font-medium" for="runner-image">Image Docker</label>
                                <input
                                    id="runner-image"
                                    class="input input-bordered input-sm w-full font-mono text-[11px]"
                                    list="runner-image-presets"
                                    value={form.image}
                                    onInput={(event) => setForm((current) => ({
                                        ...current,
                                        image: (event.target as HTMLInputElement).value,
                                    }))}
                                />
                                <datalist id="runner-image-presets">
                                    {POPCORN_IMAGE_PRESETS.map((preset) => (
                                        <option key={preset.image} value={preset.image}>{preset.label}</option>
                                    ))}
                                </datalist>
                                <div class="flex flex-wrap gap-1.5">
                                    {POPCORN_IMAGE_PRESETS.map((preset) => (
                                        <button
                                            key={preset.image}
                                            type="button"
                                            class="btn btn-ghost btn-xs"
                                            onClick={() => setForm((current) => ({
                                                ...current,
                                                image: preset.image,
                                            }))}
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <button
                            type="button"
                            class="btn btn-ghost btn-xs justify-self-start px-0"
                            onClick={() => setShowAdvanced((current) => !current)}
                        >
                            {showAdvanced ? 'Masquer les options avancées' : 'Options avancées'}
                        </button>

                        {showAdvanced && (
                            <div class="grid gap-3 rounded-xl border border-base-300/60 bg-base-200/30 p-3">
                                <div class="grid gap-3 sm:grid-cols-2">
                                    <div class="grid gap-1.5">
                                        <label class="text-xs font-medium" for="runner-container-name">Nom du conteneur</label>
                                        <input
                                            id="runner-container-name"
                                            class="input input-bordered input-sm w-full font-mono"
                                            placeholder="github-runner-…"
                                            value={form.container_name}
                                            onInput={(event) => setForm((current) => ({
                                                ...current,
                                                container_name: (event.target as HTMLInputElement).value,
                                            }))}
                                        />
                                    </div>
                                    <div class="grid gap-1.5">
                                        <label class="text-xs font-medium" for="runner-network">Réseau</label>
                                        <select
                                            id="runner-network"
                                            class="select select-bordered select-sm w-full"
                                            value={form.network_mode}
                                            onChange={(event) => setForm((current) => ({
                                                ...current,
                                                network_mode: (event.target as HTMLSelectElement).value as FormState['network_mode'],
                                            }))}
                                        >
                                            <option value="bridge">bridge</option>
                                            <option value="host">host</option>
                                            <option value="none">none</option>
                                        </select>
                                    </div>
                                </div>

                                <div class="grid gap-1.5">
                                    <label class="text-xs font-medium" for="runner-timezone">Timezone</label>
                                    <input
                                        id="runner-timezone"
                                        class="input input-bordered input-sm w-full"
                                        value={form.timezone}
                                        onInput={(event) => setForm((current) => ({
                                            ...current,
                                            timezone: (event.target as HTMLInputElement).value,
                                        }))}
                                    />
                                </div>

                                <div class="grid gap-1.5">
                                    <label class="text-xs font-medium" for="runner-volumes">
                                        Volumes (un par ligne, host:container)
                                    </label>
                                    <textarea
                                        id="runner-volumes"
                                        class="textarea textarea-bordered textarea-sm w-full font-mono text-[11px]"
                                        rows={4}
                                        placeholder={'/media/Docker/AppData/runner/client:/shared-data\n/media/Docker/AppData/runner/npm:/home/runner/.npm'}
                                        value={form.volumes}
                                        onInput={(event) => setForm((current) => ({
                                            ...current,
                                            volumes: (event.target as HTMLTextAreaElement).value,
                                        }))}
                                    />
                                </div>

                                <div class="grid gap-1.5">
                                    <label class="text-xs font-medium" for="runner-extra-env">
                                        Variables d’environnement supplémentaires (KEY=value)
                                    </label>
                                    <textarea
                                        id="runner-extra-env"
                                        class="textarea textarea-bordered textarea-sm w-full font-mono text-[11px]"
                                        rows={3}
                                        placeholder={'ANDROID_HOME=/opt/android-sdk\nANDROID_SDK_ROOT=/opt/android-sdk'}
                                        value={form.extra_env}
                                        onInput={(event) => setForm((current) => ({
                                            ...current,
                                            extra_env: (event.target as HTMLTextAreaElement).value,
                                        }))}
                                    />
                                    <p class="text-[11px] text-base-content/50">
                                        Déjà gérées automatiquement : REPO_URL, RUNNER_NAME, ACCESS_TOKEN/RUNNER_TOKEN, LABELS, TZ, RUNNER_REPLACE_EXISTING.
                                        Les images Popcorn embarquent déjà ANDROID_* / PATH.
                                    </p>
                                </div>

                                <label class="flex items-center gap-2 text-xs">
                                    <input
                                        type="checkbox"
                                        class="checkbox checkbox-sm"
                                        checked={form.replace_existing}
                                        onChange={(event) => setForm((current) => ({
                                            ...current,
                                            replace_existing: (event.target as HTMLInputElement).checked,
                                        }))}
                                    />
                                    Remplacer le runner GitHub homonyme (RUNNER_REPLACE_EXISTING)
                                </label>

                                <label class="flex items-center gap-2 text-xs">
                                    <input
                                        type="checkbox"
                                        class="checkbox checkbox-sm"
                                        checked={form.recreate}
                                        onChange={(event) => setForm((current) => ({
                                            ...current,
                                            recreate: (event.target as HTMLInputElement).checked,
                                        }))}
                                    />
                                    Recréer si le conteneur existe déjà
                                </label>
                            </div>
                        )}
                    </>
                )}
            </form>
        </Modal>
    );
}
