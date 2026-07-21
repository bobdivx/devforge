import { FolderGit2, LoaderCircle, Search } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Modal } from '../ui/Modal';
import {
    domainApi,
    type CreateApplicationInput,
    type DeploymentTarget,
    type Environment,
    type GithubAppSummary,
    type GithubBranch,
    type GithubRepository,
    type Project,
} from '../../lib/domain-api';
import { routeHref } from '../../lib/routes';

const buildPacks: Array<{ value: CreateApplicationInput['build_pack']; label: string }> = [
    { value: 'nixpacks', label: 'Nixpacks (auto-détection)' },
    { value: 'railpack', label: 'Railpack' },
    { value: 'static', label: 'Site statique' },
    { value: 'dockerfile', label: 'Dockerfile' },
    { value: 'dockercompose', label: 'Docker Compose' },
];

type Props = {
    open: boolean;
    legacyBaseUrl: string;
    onClose: () => void;
    onCreated: (applicationUuid: string) => void;
};

type DestinationOption = {
    serverUuid: string;
    serverName: string;
    destinationUuid: string;
    destinationName: string;
    label: string;
};

export function CreateApplicationModal({ open, legacyBaseUrl, onClose, onCreated }: Props) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [targets, setTargets] = useState<DeploymentTarget[]>([]);
    const [githubApps, setGithubApps] = useState<GithubAppSummary[]>([]);
    const [repositories, setRepositories] = useState<GithubRepository[]>([]);
    const [branches, setBranches] = useState<GithubBranch[]>([]);
    const [repoSearch, setRepoSearch] = useState('');
    const [loadingRepos, setLoadingRepos] = useState(false);
    const [loadingBranches, setLoadingBranches] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({
        project_uuid: '',
        environment_uuid: '',
        destination_uuid: '',
        github_app_uuid: '',
        repository_id: 0,
        git_repository: '',
        git_branch: 'main',
        build_pack: 'nixpacks' as CreateApplicationInput['build_pack'],
        instant_deploy: true,
    });

    useEffect(() => {
        if (!open) {
            return;
        }

        setError(null);
        setRepoSearch('');
        setRepositories([]);
        setBranches([]);

        Promise.all([
            domainApi.projects(),
            domainApi.deploymentTargets(),
            domainApi.githubApps(),
        ])
            .then(([projectsResponse, targetsResponse, appsResponse]) => {
                const nextProjects = projectsResponse.data;
                const nextTargets = targetsResponse.data;
                const nextApps = appsResponse.data;
                const firstProject = nextProjects[0];
                const firstEnvironment = firstProject?.environments?.[0];
                const firstDestination = nextTargets[0]?.destinations[0];

                setProjects(nextProjects);
                setTargets(nextTargets);
                setGithubApps(nextApps);
                setForm({
                    project_uuid: firstProject?.uuid ?? '',
                    environment_uuid: firstEnvironment?.uuid ?? '',
                    destination_uuid: firstDestination?.uuid ?? '',
                    github_app_uuid: nextApps[0]?.uuid ?? '',
                    repository_id: 0,
                    git_repository: '',
                    git_branch: 'main',
                    build_pack: 'nixpacks',
                    instant_deploy: true,
                });
            })
            .catch((loadError: unknown) => {
                setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les données.');
            });
    }, [open]);

    const environments = useMemo<Environment[]>(() => {
        const project = projects.find((item) => item.uuid === form.project_uuid);
        return project?.environments ?? [];
    }, [projects, form.project_uuid]);

    const destinationOptions = useMemo<DestinationOption[]>(() => targets.flatMap((server) => server.destinations.map((destination) => ({
        serverUuid: server.uuid,
        serverName: server.name,
        destinationUuid: destination.uuid,
        destinationName: destination.name,
        label: `${server.name} / ${destination.name}`,
    }))), [targets]);

    const filteredRepositories = useMemo(() => {
        const normalized = repoSearch.trim().toLowerCase();
        if (!normalized) {
            return repositories;
        }

        return repositories.filter((repository) => repository.full_name.toLowerCase().includes(normalized)
            || repository.name.toLowerCase().includes(normalized)
            || (repository.description ?? '').toLowerCase().includes(normalized));
    }, [repositories, repoSearch]);

    const selectedRepository = useMemo(
        () => repositories.find((repository) => repository.id === form.repository_id) ?? null,
        [repositories, form.repository_id],
    );

    useEffect(() => {
        if (!open || !form.github_app_uuid) {
            return;
        }

        setLoadingRepos(true);
        setRepositories([]);
        setBranches([]);
        setForm((current) => ({ ...current, repository_id: 0, git_repository: '', git_branch: 'main' }));

        domainApi.githubRepositories(form.github_app_uuid)
            .then((response) => setRepositories(response.data))
            .catch((loadError: unknown) => {
                setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les dépôts GitHub.');
            })
            .finally(() => setLoadingRepos(false));
    }, [open, form.github_app_uuid]);

    useEffect(() => {
        if (!open || !form.github_app_uuid || !selectedRepository) {
            return;
        }

        setLoadingBranches(true);
        domainApi.githubBranches(form.github_app_uuid, selectedRepository.owner, selectedRepository.name)
            .then((response) => {
                setBranches(response.data);
                setForm((current) => ({
                    ...current,
                    git_repository: `${selectedRepository.owner}/${selectedRepository.name}`,
                    git_branch: response.data[0]?.name ?? selectedRepository.default_branch ?? 'main',
                }));
            })
            .catch((loadError: unknown) => {
                setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les branches.');
            })
            .finally(() => setLoadingBranches(false));
    }, [open, form.github_app_uuid, selectedRepository?.id]);

    const legacySourcesUrl = useMemo(() => {
        // DevForge Connexions (sidebar) — Coolify legacy for creating the GitHub App itself.
        if (!legacyBaseUrl) {
            return routeHref('/connexions');
        }

        const url = new URL('/sources', `${legacyBaseUrl.replace(/\/$/, '')}/`);
        url.searchParams.set('legacy', '1');
        return url.toString();
    }, [legacyBaseUrl]);

    const handleSubmit = async (event: Event) => {
        event.preventDefault();
        if (!form.project_uuid || !form.environment_uuid || !form.destination_uuid || !form.github_app_uuid || !form.git_repository || !form.git_branch) {
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const response = await domainApi.createApplication({
                project_uuid: form.project_uuid,
                environment_uuid: form.environment_uuid,
                destination_uuid: form.destination_uuid,
                github_app_uuid: form.github_app_uuid,
                git_repository: form.git_repository,
                repository_id: form.repository_id || undefined,
                git_branch: form.git_branch,
                build_pack: form.build_pack,
                instant_deploy: form.instant_deploy,
            });
            onCreated(response.data.uuid);
            onClose();
        } catch (submitError: unknown) {
            setError(submitError instanceof Error ? submitError.message : 'Erreur lors de la création.');
        } finally {
            setSubmitting(false);
        }
    };

    const canSubmit = Boolean(
        form.project_uuid
        && form.environment_uuid
        && form.destination_uuid
        && form.github_app_uuid
        && form.git_repository
        && form.git_branch
        && !submitting,
    );

    return (
        <Modal
            open={open}
            title="Nouvelle application"
            onClose={onClose}
            footer={(
                <>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>Annuler</button>
                    <button class="btn btn-primary btn-sm" type="submit" form="create-application-form" disabled={!canSubmit}>
                        {submitting && <span class="loading loading-spinner loading-xs" />}
                        Créer et déployer
                    </button>
                </>
            )}
        >
            <form id="create-application-form" class="grid gap-4" onSubmit={handleSubmit}>
                <p class="text-xs text-base-content/60">
                    Déployez une application depuis vos dépôts GitHub connectés à Coolify.
                </p>

                {githubApps.length === 0 ? (
                    <div class="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
                        <p class="font-medium text-warning">Aucun compte GitHub connecté</p>
                        <p class="mt-1 text-xs text-base-content/70">
                            Connectez GitHub (compte bobdivx / org) pour lister vos dépôts privés.
                        </p>
                        <a class="btn btn-warning btn-sm mt-3" href={legacySourcesUrl}>
                            <FolderGit2 class="size-3.5" aria-hidden />
                            Ouvrir GitHub
                        </a>
                    </div>
                ) : (
                    <>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <div class="grid gap-1.5">
                                <label class="text-xs font-medium" for="app-project">Projet</label>
                                <select
                                    id="app-project"
                                    class="select select-bordered select-sm w-full"
                                    value={form.project_uuid}
                                    onChange={(event) => {
                                        const projectUuid = (event.target as HTMLSelectElement).value;
                                        const project = projects.find((item) => item.uuid === projectUuid);
                                        const environment = project?.environments?.[0];
                                        setForm((current) => ({
                                            ...current,
                                            project_uuid: projectUuid,
                                            environment_uuid: environment?.uuid ?? '',
                                        }));
                                    }}
                                >
                                    {projects.map((project) => (
                                        <option key={project.uuid} value={project.uuid}>{project.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div class="grid gap-1.5">
                                <label class="text-xs font-medium" for="app-environment">Environnement</label>
                                <select
                                    id="app-environment"
                                    class="select select-bordered select-sm w-full"
                                    value={form.environment_uuid}
                                    onChange={(event) => setForm((current) => ({
                                        ...current,
                                        environment_uuid: (event.target as HTMLSelectElement).value,
                                    }))}
                                >
                                    {environments.map((environment) => (
                                        <option key={environment.uuid} value={environment.uuid}>{environment.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="app-destination">Serveur / destination</label>
                            <select
                                id="app-destination"
                                class="select select-bordered select-sm w-full"
                                value={form.destination_uuid}
                                onChange={(event) => setForm((current) => ({
                                    ...current,
                                    destination_uuid: (event.target as HTMLSelectElement).value,
                                }))}
                            >
                                {destinationOptions.map((destination) => (
                                    <option key={destination.destinationUuid} value={destination.destinationUuid}>
                                        {destination.label}
                                    </option>
                                ))}
                            </select>
                            {destinationOptions.length === 0 && (
                                <p class="text-[11px] text-warning">Aucun serveur avec destination disponible. Ajoutez un serveur dans Paramètres.</p>
                            )}
                        </div>

                        {githubApps.length > 1 && (
                            <div class="grid gap-1.5">
                                <label class="text-xs font-medium" for="app-github">Compte GitHub</label>
                                <select
                                    id="app-github"
                                    class="select select-bordered select-sm w-full"
                                    value={form.github_app_uuid}
                                    onChange={(event) => setForm((current) => ({
                                        ...current,
                                        github_app_uuid: (event.target as HTMLSelectElement).value,
                                    }))}
                                >
                                    {githubApps.map((app) => (
                                        <option key={app.uuid} value={app.uuid}>
                                            {app.account_login ? `@${app.account_login}` : (app.display_name ?? app.name)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="app-repo-search">Dépôt GitHub</label>
                            <label class="input input-bordered input-sm flex items-center gap-2">
                                <Search class="size-3.5 opacity-50" aria-hidden />
                                <input
                                    id="app-repo-search"
                                    class="grow"
                                    type="search"
                                    placeholder="Rechercher un dépôt…"
                                    value={repoSearch}
                                    onInput={(event) => setRepoSearch((event.target as HTMLInputElement).value)}
                                />
                            </label>
                            <div class="max-h-48 overflow-y-auto rounded-xl border border-base-300/70">
                                {loadingRepos ? (
                                    <div class="flex items-center justify-center gap-2 p-6 text-xs text-base-content/55">
                                        <LoaderCircle class="size-4 animate-spin" aria-hidden />
                                        Chargement des dépôts…
                                    </div>
                                ) : filteredRepositories.length === 0 ? (
                                    <p class="p-4 text-xs text-base-content/55">Aucun dépôt trouvé.</p>
                                ) : (
                                    filteredRepositories.map((repository) => (
                                        <button
                                            key={repository.id}
                                            type="button"
                                            class={`flex w-full items-start gap-3 border-b border-base-300/50 px-3 py-2.5 text-left transition last:border-b-0 hover:bg-base-200/60 ${
                                                form.repository_id === repository.id ? 'bg-primary/10' : ''
                                            }`}
                                            onClick={() => setForm((current) => ({
                                                ...current,
                                                repository_id: repository.id,
                                                git_repository: `${repository.owner}/${repository.name}`,
                                            }))}
                                        >
                                            <FolderGit2 class="mt-0.5 size-4 shrink-0 text-base-content/45" aria-hidden />
                                            <span class="min-w-0">
                                                <span class="block truncate text-sm font-medium">{repository.full_name}</span>
                                                {repository.description && (
                                                    <span class="block truncate text-[11px] text-base-content/50">{repository.description}</span>
                                                )}
                                            </span>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>

                        <div class="grid gap-3 sm:grid-cols-2">
                            <div class="grid gap-1.5">
                                <label class="text-xs font-medium" for="app-branch">Branche</label>
                                <select
                                    id="app-branch"
                                    class="select select-bordered select-sm w-full"
                                    value={form.git_branch}
                                    disabled={!selectedRepository || loadingBranches}
                                    onChange={(event) => setForm((current) => ({
                                        ...current,
                                        git_branch: (event.target as HTMLSelectElement).value,
                                    }))}
                                >
                                    {branches.map((branch) => (
                                        <option key={branch.name} value={branch.name}>{branch.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div class="grid gap-1.5">
                                <label class="text-xs font-medium" for="app-build-pack">Build pack</label>
                                <select
                                    id="app-build-pack"
                                    class="select select-bordered select-sm w-full"
                                    value={form.build_pack}
                                    onChange={(event) => setForm((current) => ({
                                        ...current,
                                        build_pack: (event.target as HTMLSelectElement).value as CreateApplicationInput['build_pack'],
                                    }))}
                                >
                                    {buildPacks.map((pack) => (
                                        <option key={pack.value} value={pack.value}>{pack.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <label class="flex items-center gap-2 text-xs">
                            <input
                                class="checkbox checkbox-primary checkbox-sm"
                                type="checkbox"
                                checked={form.instant_deploy}
                                onChange={(event) => setForm((current) => ({
                                    ...current,
                                    instant_deploy: (event.target as HTMLInputElement).checked,
                                }))}
                            />
                            Lancer le déploiement immédiatement après la création
                        </label>
                    </>
                )}

                {error && (
                    <p class="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
                )}
            </form>
        </Modal>
    );
}
