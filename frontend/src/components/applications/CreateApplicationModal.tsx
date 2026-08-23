import { Upload } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Modal } from '../ui/Modal';
import { ConnectGithubButton, FinishGithubInstallButton } from '../github/ConnectGithubButton';
import { GithubRepoPicker } from '../github/GithubRepoPicker';
import {
    domainApi,
    type CreateApplicationInput,
    type DeploymentTarget,
    type Environment,
    type GithubAppSummary,
    type GithubBranch,
    type Project,
} from '../../lib/domain-api';
import type { PickedGithubRepository } from '../../lib/github-repo-picker';
import { isGithubAppInstalled } from '../../lib/onboarding-github';
import { readEnvFile } from '../../lib/env-file';
import {
    CREATE_APPLICATION_WIZARD_STEPS,
    resolveApplicationCustomDomain,
    type ApplicationUrlMode,
    type CreateApplicationWizardStep,
} from '../../lib/create-application-wizard';

const buildPacks: Array<{ value: CreateApplicationInput['build_pack']; label: string }> = [
    { value: 'nixpacks', label: 'Nixpacks (auto-détection)' },
    { value: 'railpack', label: 'Railpack' },
    { value: 'static', label: 'Site statique' },
    { value: 'dockerfile', label: 'Dockerfile' },
    { value: 'dockercompose', label: 'Docker Compose' },
];

type Props = {
    open: boolean;
    legacyBaseUrl?: string;
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

export function CreateApplicationModal({ open, onClose, onCreated }: Props) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [targets, setTargets] = useState<DeploymentTarget[]>([]);
    const [githubApps, setGithubApps] = useState<GithubAppSummary[]>([]);
    const [pendingGithubApps, setPendingGithubApps] = useState<GithubAppSummary[]>([]);
    const [pickedRepositories, setPickedRepositories] = useState<PickedGithubRepository[]>([]);
    const [branches, setBranches] = useState<GithubBranch[]>([]);
    const [loadingBranches, setLoadingBranches] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [step, setStep] = useState<CreateApplicationWizardStep>('source');
    const [urlMode, setUrlMode] = useState<ApplicationUrlMode | null>(null);
    const [customUrl, setCustomUrl] = useState('');
    const [importEnv, setImportEnv] = useState(false);
    const [envFileName, setEnvFileName] = useState<string | null>(null);
    const [envContents, setEnvContents] = useState<string | null>(null);
    const envFileRef = useRef<HTMLInputElement>(null);
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
        setStep('source');
        setUrlMode(null);
        setCustomUrl('');
        setPickedRepositories([]);
        setBranches([]);
        setImportEnv(false);
        setEnvFileName(null);
        setEnvContents(null);

        if (envFileRef.current) {
            envFileRef.current.value = '';
        }

        Promise.all([
            domainApi.projects(),
            domainApi.deploymentTargets(),
            domainApi.githubApps(),
        ])
            .then(([projectsResponse, targetsResponse, appsResponse]) => {
                const nextProjects = projectsResponse.data;
                const nextTargets = targetsResponse.data;
                const listedApps = appsResponse.data;
                const nextApps = listedApps.filter(isGithubAppInstalled);
                const pendingApps = listedApps.filter((app) => !isGithubAppInstalled(app));
                const firstProject = nextProjects[0];
                const firstEnvironment = firstProject?.environments?.[0];
                const firstDestination = nextTargets[0]?.destinations[0];

                setProjects(nextProjects);
                setTargets(nextTargets);
                setGithubApps(nextApps);
                setPendingGithubApps(pendingApps);
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

    const selectedRepository = pickedRepositories[0] ?? null;

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

    const handleSubmit = async (event: Event) => {
        event.preventDefault();
        if (step !== 'options') {
            return;
        }

        if (!form.project_uuid || !form.environment_uuid || !form.destination_uuid || !form.github_app_uuid || !form.git_repository || !form.git_branch) {
            return;
        }

        if (importEnv && !envContents) {
            setError('Choisis un fichier .env à importer, ou décoche l’option.');

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
                env_contents: envContents ?? undefined,
                domains: resolveApplicationCustomDomain(urlMode, customUrl),
            });
            onCreated(response.data.uuid);
            onClose();
        } catch (submitError: unknown) {
            setError(submitError instanceof Error ? submitError.message : 'Erreur lors de la création.');
        } finally {
            setSubmitting(false);
        }
    };

    const canAdvanceSource = Boolean(
        form.project_uuid
        && form.environment_uuid
        && form.destination_uuid
        && form.github_app_uuid
        && form.git_repository
        && form.git_branch
        && !submitting,
    );
    const canAdvanceDomain = urlMode === 'auto'
        || (urlMode === 'custom' && resolveApplicationCustomDomain(urlMode, customUrl) !== undefined);
    const canSubmit = canAdvanceSource && canAdvanceDomain && !submitting;
    const stepIndex = CREATE_APPLICATION_WIZARD_STEPS.findIndex((item) => item.id === step);

    return (
        <Modal
            open={open}
            title="Nouvelle application"
            size="lg"
            onClose={onClose}
            footer={(
                <>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>Annuler</button>
                    {step !== 'source' && (
                        <button
                            class="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => setStep(step === 'options' ? 'domain' : 'source')}
                        >
                            Retour
                        </button>
                    )}
                    {step === 'source' && githubApps.length > 0 && (
                        <button
                            class="btn btn-primary btn-sm"
                            type="button"
                            disabled={!canAdvanceSource}
                            onClick={() => setStep('domain')}
                        >
                            Suivant
                        </button>
                    )}
                    {step === 'domain' && (
                        <button
                            class="btn btn-primary btn-sm"
                            type="button"
                            disabled={!canAdvanceDomain}
                            onClick={() => setStep('options')}
                        >
                            Suivant
                        </button>
                    )}
                    {step === 'options' && (
                        <button class="btn btn-primary btn-sm" type="submit" form="create-application-form" disabled={!canSubmit}>
                            {submitting && <span class="loading loading-spinner loading-xs" />}
                            {form.instant_deploy
                                ? (importEnv ? 'Créer, importer et déployer' : 'Créer et déployer')
                                : (importEnv ? 'Créer et importer' : 'Créer')}
                        </button>
                    )}
                </>
            )}
        >
            <form id="create-application-form" class="grid gap-2.5 sm:gap-3 md:gap-4" onSubmit={handleSubmit}>
                <p class="text-xs text-base-content/60">
                    Étape {stepIndex + 1} sur {CREATE_APPLICATION_WIZARD_STEPS.length}
                    {' · '}
                    {CREATE_APPLICATION_WIZARD_STEPS[stepIndex]?.title}
                </p>

                {githubApps.length === 0 ? (
                    <div class="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
                        {pendingGithubApps.length > 0 ? (
                            <>
                                <p class="font-medium text-warning">GitHub App créée, installation incomplète</p>
                                <p class="mt-1 text-xs text-base-content/70">
                                    L’app {pendingGithubApps[0].display_name ?? pendingGithubApps[0].name} existe déjà.
                                    Il faut encore l’installer sur votre compte GitHub pour lister les dépôts.
                                    Le token Packages (PAT) est optionnel et ne bloque pas cette étape.
                                </p>
                                <div class="mt-3 grid gap-2">
                                    <FinishGithubInstallButton
                                        app={pendingGithubApps[0]}
                                        returnTo="applications"
                                        size="sm"
                                        onError={setError}
                                    />
                                    <ConnectGithubButton
                                        returnTo="applications"
                                        label="Recommencer avec une nouvelle app"
                                        size="sm"
                                        onError={setError}
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <p class="font-medium text-warning">GitHub n’est pas encore relié</p>
                                <p class="mt-1 text-xs text-base-content/70">
                                    Relancez la configuration GitHub, puis revenez créer l’application.
                                </p>
                                <div class="mt-3">
                                    <ConnectGithubButton
                                        returnTo="applications"
                                        label="Relancer la configuration GitHub"
                                        size="sm"
                                        onError={setError}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    <>
                        {step === 'source' && (
                        <div class="grid gap-2.5 sm:gap-3 md:gap-4">
                        <div class="grid gap-2 sm:gap-3 sm:grid-cols-2">
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

                        {githubApps.length > 0 && (
                            <div class="grid gap-1.5">
                                <span class="text-xs font-medium">Dépôt GitHub</span>
                                <GithubRepoPicker
                                    apps={githubApps}
                                    mode="single"
                                    selected={pickedRepositories}
                                    onChange={(next) => {
                                        const repository = next[0] ?? null;
                                        setPickedRepositories(repository ? [repository] : []);
                                        setForm((current) => ({
                                            ...current,
                                            github_app_uuid: repository?.github_app_uuid ?? current.github_app_uuid,
                                            repository_id: repository?.id ?? 0,
                                            git_repository: repository ? `${repository.owner}/${repository.name}` : '',
                                            git_branch: repository?.default_branch || 'main',
                                        }));
                                    }}
                                    returnTo="applications"
                                    onError={setError}
                                />
                            </div>
                        )}

                        <div class="grid gap-2 sm:gap-3 sm:grid-cols-2">
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
                        </div>
                        )}

                        {step === 'domain' && (
                            <fieldset class="grid gap-2">
                                <legend class="text-xs sm:text-sm font-medium">Cette application a-t-elle une URL personnalisée ?</legend>
                                <p class="text-xs text-base-content/55">
                                    Sinon, DevForge créera automatiquement nomdelapp.votredomaine, par exemple starbasefr.exemple.com.
                                </p>
                                <label class={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 ${
                                    urlMode === 'auto' ? 'border-primary/40 bg-primary/5' : 'border-base-300/70'
                                }`}
                                >
                                    <input
                                        class="radio radio-sm mt-0.5"
                                        type="radio"
                                        name="app-url-mode"
                                        checked={urlMode === 'auto'}
                                        onChange={() => setUrlMode('auto')}
                                    />
                                    <span class="grid gap-0.5">
                                        <span class="text-xs sm:text-sm font-semibold">Non, générer une URL automatique</span>
                                        <span class="text-xs text-base-content/55">
                                            Exemple : https://starbasefr.exemple.com
                                        </span>
                                    </span>
                                </label>
                                <label class={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 ${
                                    urlMode === 'custom' ? 'border-primary/40 bg-primary/5' : 'border-base-300/70'
                                }`}
                                >
                                    <input
                                        class="radio radio-sm mt-0.5"
                                        type="radio"
                                        name="app-url-mode"
                                        checked={urlMode === 'custom'}
                                        onChange={() => setUrlMode('custom')}
                                    />
                                    <span class="grid gap-0.5">
                                        <span class="text-xs sm:text-sm font-semibold">Oui, j’ai une URL pour cette app</span>
                                        <span class="text-xs text-base-content/55">
                                            Exemple : https://blog.maison.local
                                        </span>
                                    </span>
                                </label>
                                {urlMode === 'custom' && (
                                    <label class="grid gap-1.5">
                                        <span class="text-xs font-medium">URL de l’application</span>
                                        <input
                                            class="input input-bordered input-sm w-full rounded-xl"
                                            value={customUrl}
                                            placeholder="https://blog.maison.local"
                                            inputMode="url"
                                            onInput={(event) => setCustomUrl(event.currentTarget.value)}
                                        />
                                    </label>
                                )}
                            </fieldset>
                        )}

                        {step === 'options' && (
                        <div class="grid gap-2.5 sm:gap-3 md:gap-4">
                        <div class="grid gap-2 rounded-xl border border-base-300/70 bg-base-200/30 p-3">
                            <label class="flex items-start gap-2 text-xs">
                                <input
                                    class="checkbox checkbox-primary checkbox-sm mt-0.5"
                                    type="checkbox"
                                    checked={importEnv}
                                    onChange={(event) => {
                                        const checked = (event.target as HTMLInputElement).checked;
                                        setImportEnv(checked);

                                        if (!checked) {
                                            setEnvFileName(null);
                                            setEnvContents(null);

                                            if (envFileRef.current) {
                                                envFileRef.current.value = '';
                                            }
                                        }
                                    }}
                                />
                                <span>
                                    <span class="block font-medium">Importer un fichier .env avant le déploiement</span>
                                    <span class="mt-0.5 block text-[11px] text-base-content/55">
                                        Les variables (Turso, secrets, etc.) seront créées avant le premier build.
                                    </span>
                                </span>
                            </label>

                            {importEnv && (
                                <div class="grid gap-1.5 pl-6">
                                    <input
                                        ref={envFileRef}
                                        id="create-app-env-file"
                                        class="sr-only"
                                        type="file"
                                        accept=".env,.txt,text/plain"
                                        aria-label="Fichier .env à importer"
                                        onChange={(event) => {
                                            const file = (event.target as HTMLInputElement).files?.[0];

                                            if (!file) {
                                                setEnvFileName(null);
                                                setEnvContents(null);

                                                return;
                                            }

                                            if (file.size > 262144) {
                                                setError('Le fichier .env dépasse 256 Ko.');
                                                setEnvFileName(null);
                                                setEnvContents(null);

                                                return;
                                            }

                                            void readEnvFile(file)
                                                .then((contents) => {
                                                    setEnvFileName(file.name);
                                                    setEnvContents(contents);
                                                    setError(null);
                                                })
                                                .catch(() => {
                                                    setError('Impossible de lire ce fichier .env.');
                                                    setEnvFileName(null);
                                                    setEnvContents(null);
                                                });
                                        }}
                                    />
                                    <button
                                        class="btn btn-ghost btn-sm w-fit rounded-full"
                                        type="button"
                                        onClick={() => envFileRef.current?.click()}
                                    >
                                        <Upload class="size-3.5" aria-hidden />
                                        {envFileName ? 'Changer de fichier' : 'Choisir un fichier .env'}
                                    </button>
                                    {envFileName && (
                                        <p class="text-[11px] text-base-content/60">
                                            Fichier prêt : <span class="font-mono">{envFileName}</span>
                                        </p>
                                    )}
                                </div>
                            )}
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
                        </div>
                        )}
                    </>
                )}

                {error && (
                    <p class="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
                )}
            </form>
        </Modal>
    );
}
