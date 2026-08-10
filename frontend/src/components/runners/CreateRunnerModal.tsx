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
    use_saved_pat: boolean;
    save_pat: boolean;
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
    pull_image: boolean;
    volumes: string;
    extra_env: string;
};

type WizardStep = 1 | 2 | 3;

const STEPS: Array<{ id: WizardStep; title: string; hint: string }> = [
    { id: 1, title: 'Accès GitHub', hint: 'GitHub App ou PAT' },
    { id: 2, title: 'Dépôt', hint: 'Choisir le repo' },
    { id: 3, title: 'Déploiement', hint: 'Serveur et image' },
];

const defaultForm = (): FormState => ({
    auth_mode: 'registration',
    access_token: '',
    use_saved_pat: true,
    save_pat: true,
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
    pull_image: true,
    volumes: '',
    extra_env: '',
});

const POPCORN_IMAGE_PRESETS: Array<{ label: string; image: string }> = [
    { label: 'Popcorn client (GHCR)', image: 'ghcr.io/bobdivx/popcorn-github-runner-client:latest' },
    { label: 'Popcorn server (GHCR)', image: 'ghcr.io/bobdivx/popcorn-github-runner-server:latest' },
    { label: 'Popcorn client (Docker Hub)', image: 'bobdivx/popcorn-github-runner-client:latest' },
    { label: 'Popcorn server (Docker Hub)', image: 'bobdivx/popcorn-github-runner-server:latest' },
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

function looksLikeAuthPermissionError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('permission')
        || normalized.includes('administration')
        || normalized.includes('jeton')
        || normalized.includes('authentification')
        || normalized.includes('403')
        || normalized.includes('401');
}

export function CreateRunnerModal({ open, prefill = null, onClose, onCreated }: Props) {
    const [form, setForm] = useState<FormState>(defaultForm);
    const [step, setStep] = useState<WizardStep>(1);
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
        setStep(1);
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
                    use_saved_pat: Boolean(apps.find((app) => app.has_packages_token)),
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

    const selectedServer = servers.find((server) => server.uuid === form.server_uuid) ?? null;
    const selectedApp = githubApps.find((app) => app.uuid === form.github_app_uuid) ?? null;
    const appsWithSavedPat = githubApps.filter((app) => Boolean(app.has_packages_token));
    const selectedAppHasSavedPat = Boolean(selectedApp?.has_packages_token);

    const step1Ready = form.auth_mode === 'pat'
        ? (form.use_saved_pat
            ? Boolean(form.github_app_uuid && selectedAppHasSavedPat)
            : form.access_token.trim().length > 0)
        : Boolean(form.github_app_uuid);

    const step2Ready = Boolean(owner && repo);

    const canSubmit = Boolean(
        step1Ready
        && step2Ready
        && form.server_uuid
        && form.runner_name.trim()
        && !submitting
        && !loading,
    );

    function goToPatStep() {
        setError(null);
        setStep(1);
        setForm((current) => {
            const preferredApp = githubApps.find((app) => app.has_packages_token)
                ?? githubApps.find((app) => app.uuid === current.github_app_uuid)
                ?? githubApps[0]
                ?? null;

            return {
                ...current,
                auth_mode: 'pat',
                github_app_uuid: preferredApp?.uuid ?? current.github_app_uuid,
                use_saved_pat: Boolean(preferredApp?.has_packages_token),
            };
        });
    }

    function goNext() {
        setError(null);
        if (step === 1 && !step1Ready) {
            setError(form.auth_mode === 'pat'
                ? (form.use_saved_pat
                    ? 'Sélectionnez une GitHub App qui a déjà un PAT enregistré, ou collez un nouveau token.'
                    : 'Collez un Personal Access Token GitHub pour continuer.')
                : 'Choisissez une GitHub App, ou passez en mode PAT.');
            return;
        }
        if (step === 2 && !step2Ready) {
            setError('Indiquez le dépôt (owner/repo) avant de continuer.');
            return;
        }
        setStep((current) => (current < 3 ? ((current + 1) as WizardStep) : current));
    }

    function goBack() {
        setError(null);
        setStep((current) => (current > 1 ? ((current - 1) as WizardStep) : current));
    }

    async function handleSubmit(event: Event) {
        event.preventDefault();
        if (step !== 3) {
            goNext();
            return;
        }
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
            access_token: form.auth_mode === 'pat' && !form.use_saved_pat
                ? form.access_token.trim()
                : undefined,
            use_saved_pat: form.auth_mode === 'pat' ? form.use_saved_pat : undefined,
            save_pat: form.auth_mode === 'pat' && !form.use_saved_pat
                ? form.save_pat && Boolean(form.github_app_uuid)
                : undefined,
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
            pull_image: form.pull_image,
            volumes: volumes.length > 0 ? volumes : undefined,
            extra_env: extraEnv.length > 0 ? extraEnv : undefined,
        };

        try {
            await domainApi.createGithubRunner(payload);
            onCreated();
            onClose();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Création impossible.';
            setError(message);
            if (looksLikeAuthPermissionError(message)) {
                setStep(1);
            }
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Modal
            open={open}
            title="Nouveau runner GitHub"
            size="lg"
            onClose={onClose}
            footer={(
                <>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>Annuler</button>
                    {step > 1 && (
                        <button class="btn btn-ghost btn-sm" type="button" onClick={goBack} disabled={submitting}>
                            Retour
                        </button>
                    )}
                    {step < 3 ? (
                        <button
                            class="btn btn-primary btn-sm"
                            type="button"
                            onClick={goNext}
                            disabled={loading || (step === 1 && !step1Ready) || (step === 2 && !step2Ready)}
                        >
                            Continuer
                        </button>
                    ) : (
                        <button class="btn btn-primary btn-sm" type="submit" form="create-runner-form" disabled={!canSubmit}>
                            {submitting && <span class="loading loading-spinner loading-xs" />}
                            Créer le runner
                        </button>
                    )}
                </>
            )}
        >
            <form id="create-runner-form" class="grid gap-4" onSubmit={handleSubmit}>
                <ol class="grid gap-2 sm:grid-cols-3">
                    {STEPS.map((item) => {
                        const active = step === item.id;
                        const done = step > item.id;
                        return (
                            <li key={item.id}>
                                <button
                                    type="button"
                                    class={`w-full rounded-xl border px-3 py-2 text-left transition ${
                                        active
                                            ? 'border-primary/40 bg-primary/10'
                                            : done
                                                ? 'border-success/30 bg-success/5'
                                                : 'border-base-300/70 bg-base-200/20'
                                    }`}
                                    onClick={() => {
                                        if (item.id < step || (item.id === 2 && step1Ready) || (item.id === 3 && step1Ready && step2Ready)) {
                                            setError(null);
                                            setStep(item.id);
                                        }
                                    }}
                                >
                                    <p class="text-[11px] uppercase tracking-wide text-base-content/45">
                                        Étape {item.id}
                                    </p>
                                    <p class="text-xs font-medium">{item.title}</p>
                                    <p class="text-[11px] text-base-content/50">{item.hint}</p>
                                </button>
                            </li>
                        );
                    })}
                </ol>

                {error && (
                    <div class="grid gap-2 rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
                        <p>{error}</p>
                        {looksLikeAuthPermissionError(error) && form.auth_mode === 'registration' && (
                            <button class="btn btn-outline btn-error btn-xs justify-self-start" type="button" onClick={goToPatStep}>
                                Utiliser un PAT à la place
                            </button>
                        )}
                    </div>
                )}

                {step === 1 && (
                    <div class="grid gap-4">
                        <p class="text-xs text-base-content/60">
                            Choisissez comment DevForge s’authentifie auprès de GitHub pour enregistrer le runner.
                        </p>

                        <fieldset class="grid gap-2">
                            <legend class="sr-only">Mode d’authentification</legend>

                            <label class={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-xs ${
                                form.auth_mode === 'registration'
                                    ? 'border-primary/40 bg-primary/5'
                                    : 'border-base-300/70 bg-base-200/20'
                            }`}>
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
                                <span class="min-w-0 flex-1">
                                    <span class="font-medium">GitHub App (recommandé)</span>
                                    <span class="mt-0.5 block text-base-content/55">
                                        Génère un jeton d’enregistrement courte durée. Aucun PAT longue durée n’est stocké dans le conteneur.
                                    </span>
                                </span>
                            </label>

                            <label class={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-xs ${
                                form.auth_mode === 'pat'
                                    ? 'border-primary/40 bg-primary/5'
                                    : 'border-base-300/70 bg-base-200/20'
                            }`}>
                                <input
                                    type="radio"
                                    class="radio radio-sm mt-0.5"
                                    name="runner-auth-mode"
                                    checked={form.auth_mode === 'pat'}
                                    onChange={() => setForm((current) => ({
                                        ...current,
                                        auth_mode: 'pat',
                                        use_saved_pat: githubApps.some((app) => Boolean(app.has_packages_token)),
                                        github_app_uuid: current.github_app_uuid
                                            || githubApps.find((app) => app.has_packages_token)?.uuid
                                            || githubApps[0]?.uuid
                                            || '',
                                    }))}
                                />
                                <span class="min-w-0 flex-1">
                                    <span class="font-medium">Personal Access Token (PAT)</span>
                                    <span class="mt-0.5 block text-base-content/55">
                                        Comme CasaOS <code class="text-[11px]">ACCESS_TOKEN</code> — le plus simple si la GitHub App n’a pas le droit Administration.
                                    </span>
                                </span>
                            </label>
                        </fieldset>

                        {form.auth_mode === 'registration' ? (
                            <div class="grid gap-3 rounded-xl border border-base-300/70 bg-base-200/20 p-3">
                                {githubApps.length === 0 ? (
                                    <p class="text-xs text-warning">
                                        Aucune GitHub App connectée. Passez en mode PAT, ou connectez une App dans les sources Git.
                                    </p>
                                ) : (
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
                                            {githubApps.map((app) => (
                                                <option key={app.uuid} value={app.uuid}>
                                                    {app.display_name ?? app.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div class="rounded-lg border border-base-300/60 bg-base-100/60 px-3 py-2 text-[11px] text-base-content/65">
                                    <p class="font-medium text-base-content/80">À vérifier sur GitHub</p>
                                    <ul class="mt-1 list-disc space-y-0.5 ps-4">
                                        <li>Permission dépôt <strong>Administration : Read and write</strong></li>
                                        <li>Permission <strong>Actions</strong> (lecture au minimum)</li>
                                        <li>Réinstaller / accepter les nouvelles permissions sur le dépôt</li>
                                    </ul>
                                </div>
                            </div>
                        ) : (
                            <div class="grid gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                                <p class="text-[11px] text-base-content/65">
                                    Un PAT appartient au compte GitHub, pas à un dépôt : le même token peut servir
                                    pour plusieurs runners (popcorn-client, popcorn-server, etc.).
                                </p>

                                {appsWithSavedPat.length > 0 && (
                                    <fieldset class="grid gap-2">
                                        <legend class="text-xs font-medium">Source du PAT</legend>
                                        <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-base-300/70 bg-base-100/70 px-3 py-2 text-xs">
                                            <input
                                                type="radio"
                                                class="radio radio-sm mt-0.5"
                                                name="runner-pat-source"
                                                checked={form.use_saved_pat}
                                                onChange={() => setForm((current) => ({
                                                    ...current,
                                                    use_saved_pat: true,
                                                    access_token: '',
                                                    github_app_uuid: current.github_app_uuid
                                                        || appsWithSavedPat[0]?.uuid
                                                        || '',
                                                }))}
                                            />
                                            <span>
                                                <span class="font-medium">PAT déjà enregistré</span>
                                                <span class="mt-0.5 block text-base-content/55">
                                                    Réutiliser le token sauvegardé sur une GitHub App (Sources → GitHub).
                                                </span>
                                            </span>
                                        </label>
                                        <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-base-300/70 bg-base-100/70 px-3 py-2 text-xs">
                                            <input
                                                type="radio"
                                                class="radio radio-sm mt-0.5"
                                                name="runner-pat-source"
                                                checked={!form.use_saved_pat}
                                                onChange={() => setForm((current) => ({
                                                    ...current,
                                                    use_saved_pat: false,
                                                }))}
                                            />
                                            <span>
                                                <span class="font-medium">Coller un nouveau PAT</span>
                                                <span class="mt-0.5 block text-base-content/55">
                                                    Pour cette création, avec option de l’enregistrer pour plus tard.
                                                </span>
                                            </span>
                                        </label>
                                    </fieldset>
                                )}

                                {(form.use_saved_pat || githubApps.length > 0) && (
                                    <div class="grid gap-1.5">
                                        <label class="text-xs font-medium" for="runner-github-app-pat">
                                            {form.use_saved_pat ? 'GitHub App (PAT enregistré)' : 'GitHub App (optionnel)'}
                                        </label>
                                        <select
                                            id="runner-github-app-pat"
                                            class="select select-bordered select-sm w-full"
                                            value={form.github_app_uuid}
                                            onChange={(event) => {
                                                const uuid = (event.target as HTMLSelectElement).value;
                                                const app = githubApps.find((item) => item.uuid === uuid) ?? null;
                                                setForm((current) => ({
                                                    ...current,
                                                    github_app_uuid: uuid,
                                                    repository_id: '',
                                                    use_saved_pat: current.use_saved_pat
                                                        ? Boolean(app?.has_packages_token)
                                                        : false,
                                                }));
                                            }}
                                        >
                                            {!form.use_saved_pat && (
                                                <option value="">Saisie manuelle owner/repo</option>
                                            )}
                                            {(form.use_saved_pat ? appsWithSavedPat : githubApps).map((app) => (
                                                <option key={app.uuid} value={app.uuid}>
                                                    {(app.display_name ?? app.name)}
                                                    {app.has_packages_token ? ' · PAT enregistré' : ''}
                                                </option>
                                            ))}
                                        </select>
                                        {form.use_saved_pat && selectedAppHasSavedPat && (
                                            <p class="text-[11px] text-success">
                                                PAT enregistré sélectionné — réutilisable pour tous vos runners.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {!form.use_saved_pat && (
                                    <>
                                        <div class="grid gap-1.5">
                                            <label class="text-xs font-medium" for="runner-access-token">
                                                Personal Access Token GitHub
                                            </label>
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
                                            <p class="text-[11px] text-base-content/55">
                                                Injecté comme <code class="text-[11px]">ACCESS_TOKEN</code> dans chaque conteneur runner créé.
                                            </p>
                                        </div>

                                        {form.github_app_uuid && (
                                            <label class="flex items-center gap-2 text-xs">
                                                <input
                                                    type="checkbox"
                                                    class="checkbox checkbox-sm"
                                                    checked={form.save_pat}
                                                    onChange={(event) => setForm((current) => ({
                                                        ...current,
                                                        save_pat: (event.target as HTMLInputElement).checked,
                                                    }))}
                                                />
                                                Enregistrer ce PAT sur la GitHub App pour les prochains runners
                                            </label>
                                        )}
                                    </>
                                )}

                                <div class="rounded-lg border border-base-300/60 bg-base-100/70 px-3 py-2 text-[11px] text-base-content/65">
                                    <p class="font-medium text-base-content/80">Permissions PAT requises</p>
                                    <ul class="mt-1 list-disc space-y-0.5 ps-4">
                                        <li>Classic : <code class="text-[11px]">repo</code> + gestion des self-hosted runners</li>
                                        <li>Fine-grained : accès dépôt(s) + <strong>Administration</strong> (écriture)</li>
                                    </ul>
                                    <a
                                        class="link link-primary mt-2 inline-block"
                                        href="https://github.com/settings/tokens"
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Créer un token sur GitHub →
                                    </a>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {step === 2 && (
                    <div class="grid gap-4">
                        <p class="text-xs text-base-content/60">
                            Sur quel dépôt GitHub ce runner doit s’enregistrer ?
                        </p>

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
                                {loading && (
                                    <p class="text-[11px] text-base-content/50">Chargement des dépôts…</p>
                                )}
                            </div>
                        )}

                        {(owner || repo) && (
                            <p class="rounded-xl border border-base-300/70 bg-base-200/30 px-3 py-2 font-mono text-[11px]">
                                {owner || '…'}/{repo || '…'}
                            </p>
                        )}
                    </div>
                )}

                {step === 3 && (
                    <div class="grid gap-4">
                        <div class="rounded-xl border border-base-300/70 bg-base-200/20 px-3 py-2 text-[11px] text-base-content/65">
                            <p>
                                Auth : <strong>
                                    {form.auth_mode === 'pat'
                                        ? (form.use_saved_pat ? 'PAT enregistré' : 'PAT collé')
                                        : 'GitHub App'}
                                </strong>
                                {selectedApp ? ` (${selectedApp.display_name ?? selectedApp.name})` : ''}
                            </p>
                            <p class="font-mono">{owner}/{repo}</p>
                        </div>

                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="runner-server">Serveur DevForge</label>
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
                            {servers.length === 0 && (
                                <p class="text-[11px] text-warning">Aucun serveur disponible.</p>
                            )}
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
                                <label class="mt-1 flex items-start gap-2 text-xs">
                                    <input
                                        type="checkbox"
                                        class="checkbox checkbox-sm mt-0.5"
                                        checked={form.pull_image}
                                        onChange={(event) => setForm((current) => ({
                                            ...current,
                                            pull_image: (event.target as HTMLInputElement).checked,
                                        }))}
                                    />
                                    <span>
                                        <span class="font-medium">Tirer la dernière image (`docker pull`)</span>
                                        <span class="mt-0.5 block text-base-content/55">
                                            Avec <code class="text-[11px]">:latest</code>, sans pull le NAS réutilise souvent l’ancienne image en cache.
                                            Vérifie aussi le registry : Docker Hub (<code class="text-[11px]">bobdivx/…</code>) ≠ GHCR (<code class="text-[11px]">ghcr.io/bobdivx/…</code>).
                                        </span>
                                    </span>
                                </label>
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
                                    Remplacer le runner GitHub homonyme
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

                        <p class="text-[11px] text-base-content/50">
                            Déploiement sur {selectedServer?.name ?? '…'} avec l’image{' '}
                            <code class="text-[11px]">{form.image || '…'}</code>.
                        </p>
                    </div>
                )}
            </form>
        </Modal>
    );
}
