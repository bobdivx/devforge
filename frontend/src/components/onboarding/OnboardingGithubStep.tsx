import { Github, LoaderCircle, Search } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
    domainApi,
    type DeploymentTarget,
    type GithubAppSummary,
    type GithubRepository,
    type Project,
} from '../../lib/domain-api';
import {
    filterGithubRepositories,
    firstDestinationUuid,
    firstProjectEnvironment,
    isGithubAppInstalled,
    toggleSelectedId,
} from '../../lib/onboarding-github';
import { submitGithubManifest } from '../../lib/onboarding-steps';
import { useApiQuery } from '../../lib/use-api-query';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';

type OnboardingGithubStepProps = {
    canManage: boolean;
    onSkip: () => void;
    onConnected: () => void;
};

export function OnboardingGithubStep({ canManage, onSkip, onConnected }: OnboardingGithubStepProps) {
    const apps = useApiQuery('onboarding-github-apps', () => domainApi.githubApps());
    const items = apps.data?.data ?? [];
    const installed = items.filter(isGithubAppInstalled);
    const pending = items.filter((app) => !isGithubAppInstalled(app));

    if (apps.loading && items.length === 0) {
        return (
            <Card title="Connecter GitHub" eyebrow="Un clic">
                <DataState loading error={null} onRetry={() => void apps.reload()}>
                    <p class="text-sm text-base-content/55">Vérification de la connexion GitHub…</p>
                </DataState>
            </Card>
        );
    }

    if (installed.length > 0) {
        return (
            <OnboardingGithubRepos
                app={installed[0]}
                canManage={canManage}
                onSkip={onSkip}
                onStarted={onConnected}
            />
        );
    }

    return (
        <Card title="Connecter GitHub" eyebrow="Un clic">
            <p class="text-sm text-base-content/65">
                Vous serez envoyé sur GitHub pour autoriser DevForge. Choisissez ensuite les dépôts à créer et démarrer.
            </p>
            <DataState loading={apps.loading} error={apps.error} onRetry={() => void apps.reload()}>
                {pending.length > 0 && (
                    <ul class="mt-3 divide-y divide-base-300/70">
                        {pending.map((app) => (
                            <li class="flex flex-wrap items-center justify-between gap-3 py-3" key={app.uuid}>
                                <div class="flex items-center gap-2">
                                    <Github class="size-4 text-primary" aria-hidden />
                                    <p class="text-sm font-semibold">{app.display_name ?? app.name}</p>
                                    <StatusBadge label="À installer sur GitHub" tone="warning" />
                                </div>
                                {canManage && <InstallButton app={app} />}
                            </li>
                        ))}
                    </ul>
                )}
            </DataState>
            {canManage && pending.length === 0 && (
                <ConnectGithubButton onError={() => undefined} />
            )}
            <div class="mt-4">
                <Button variant="ghost" onClick={onSkip}>Plus tard</Button>
            </div>
        </Card>
    );
}

function ConnectGithubButton({ onError }: { onError: (message: string) => void }) {
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [organization, setOrganization] = useState('');
    const [showOrg, setShowOrg] = useState(false);

    const connect = async () => {
        setSubmitting(true);
        setError(null);
        try {
            const result = await domainApi.startGithubApp({
                name: 'DevForge',
                organization: organization.trim() || undefined,
                preview_deployments: true,
                from_onboarding: true,
            });
            submitGithubManifest(result.data.launch.action_url, result.data.launch.manifest);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Impossible de démarrer la connexion GitHub.';
            setError(message);
            onError(message);
            setSubmitting(false);
        }
    };

    return (
        <div class="mt-4 grid gap-3">
            <Button
                disabled={submitting}
                aria-label={submitting ? 'Redirection vers GitHub…' : 'Continuer avec GitHub'}
                onClick={() => void connect()}
            >
                <Github class="size-4" aria-hidden />
                {submitting ? 'Redirection vers GitHub…' : 'Continuer avec GitHub'}
            </Button>
            <button
                class="text-left text-xs text-base-content/50 underline-offset-2 hover:underline"
                type="button"
                onClick={() => setShowOrg((current) => !current)}
            >
                {showOrg ? 'Masquer les options' : 'Organisation GitHub (optionnel)'}
            </button>
            {showOrg && (
                <label class="grid gap-1 text-sm">
                    <span class="font-medium">Organisation</span>
                    <input
                        class="input input-bordered rounded-xl"
                        placeholder="laisser vide pour un compte personnel"
                        value={organization}
                        onInput={(event) => setOrganization(event.currentTarget.value)}
                    />
                </label>
            )}
            {error && <p class="text-xs text-error" role="alert">{error}</p>}
        </div>
    );
}

function InstallButton({ app }: { app: GithubAppSummary }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const install = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await domainApi.githubAppInstallUrl(app.uuid);
            window.location.assign(result.data.url);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Impossible d’ouvrir l’installation GitHub.');
            setLoading(false);
        }
    };

    return (
        <div class="grid gap-1">
            <Button size="sm" disabled={loading} onClick={() => void install()}>
                {loading ? 'Ouverture…' : 'Installer sur GitHub'}
            </Button>
            {error && <p class="text-xs text-error" role="alert">{error}</p>}
        </div>
    );
}

function OnboardingGithubRepos({
    app,
    canManage,
    onSkip,
    onStarted,
}: {
    app: GithubAppSummary;
    canManage: boolean;
    onSkip: () => void;
    onStarted: () => void;
}) {
    const [repositories, setRepositories] = useState<GithubRepository[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [targets, setTargets] = useState<DeploymentTarget[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<number[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [progress, setProgress] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        Promise.all([
            domainApi.githubRepositories(app.uuid),
            domainApi.projects(),
            domainApi.deploymentTargets(),
        ])
            .then(([reposResponse, projectsResponse, targetsResponse]) => {
                if (cancelled) {
                    return;
                }
                setRepositories(reposResponse.data);
                setProjects(projectsResponse.data);
                setTargets(targetsResponse.data);
            })
            .catch((loadError: unknown) => {
                if (!cancelled) {
                    setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les dépôts GitHub.');
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
    }, [app.uuid]);

    const visible = useMemo(() => filterGithubRepositories(repositories, query), [repositories, query]);
    const destinationUuid = firstDestinationUuid(targets);

    const startSelected = async () => {
        if (selected.length === 0) {
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            let launch = firstProjectEnvironment(projects);
            if (!launch) {
                const created = await domainApi.createProject({
                    name: 'Mon premier projet',
                    description: '',
                });
                const environment = created.data.environments?.[0];
                if (!environment) {
                    throw new Error('Le projet a été créé sans environnement.');
                }
                launch = { projectUuid: created.data.uuid, environmentUuid: environment.uuid };
            }

            if (!destinationUuid) {
                throw new Error('Aucun serveur Docker n’est encore prêt. Passez à l’étape serveur, puis revenez ici.');
            }

            const chosen = repositories.filter((repository) => selected.includes(repository.id));
            for (const [index, repository] of chosen.entries()) {
                setProgress(`Démarrage ${index + 1}/${chosen.length} · ${repository.full_name}`);
                await domainApi.createApplication({
                    project_uuid: launch.projectUuid,
                    environment_uuid: launch.environmentUuid,
                    destination_uuid: destinationUuid,
                    github_app_uuid: app.uuid,
                    git_repository: repository.full_name,
                    repository_id: repository.id,
                    git_branch: repository.default_branch || 'main',
                    build_pack: 'nixpacks',
                    name: repository.name,
                    instant_deploy: true,
                });
            }

            onStarted();
        } catch (startError: unknown) {
            setError(startError instanceof Error ? startError.message : 'Impossible de démarrer les applications.');
        } finally {
            setSubmitting(false);
            setProgress(null);
        }
    };

    return (
        <Card title="Quels dépôts démarrer ?" eyebrow="GitHub connecté">
            <p class="text-sm text-base-content/65">
                Cochez les dépôts à créer comme applications DevForge. Ils seront déployés tout de suite sur le premier
                serveur disponible.
            </p>
            <label class="mt-3 flex items-center gap-2 rounded-xl border border-base-300/70 px-3 py-2">
                <Search class="size-4 text-base-content/40" aria-hidden />
                <input
                    class="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    type="search"
                    placeholder="Rechercher un dépôt"
                    value={query}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                />
            </label>
            <DataState loading={loading} error={error && repositories.length === 0 ? error : null} onRetry={() => window.location.reload()}>
                {visible.length === 0 && !loading ? (
                    <p class="mt-3 text-sm text-base-content/60">
                        Aucun dépôt visible. Vérifiez que la GitHub App a accès aux bons dépôts.
                    </p>
                ) : (
                    <ul class="mt-3 max-h-80 divide-y divide-base-300/70 overflow-y-auto">
                        {visible.map((repository) => {
                            const checked = selected.includes(repository.id);
                            return (
                                <li key={repository.id}>
                                    <label class="flex cursor-pointer items-start gap-3 py-3">
                                        <input
                                            class="checkbox checkbox-sm mt-0.5"
                                            type="checkbox"
                                            checked={checked}
                                            disabled={!canManage || submitting}
                                            onChange={() => setSelected((current) => toggleSelectedId(current, repository.id))}
                                        />
                                        <span class="min-w-0">
                                            <span class="block text-sm font-semibold">{repository.full_name}</span>
                                            {repository.description && (
                                                <span class="mt-0.5 block text-xs text-base-content/50">{repository.description}</span>
                                            )}
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </DataState>
            {!destinationUuid && !loading && (
                <p class="mt-3 text-xs text-warning">
                    Aucun serveur Docker n’est encore prêt. Vous pourrez démarrer ces dépôts après l’étape serveur.
                </p>
            )}
            {progress && (
                <p class="mt-3 flex items-center gap-2 text-xs text-base-content/60">
                    <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                    {progress}
                </p>
            )}
            {error && repositories.length > 0 && <p class="mt-3 text-xs text-error" role="alert">{error}</p>}
            <div class="mt-4 flex flex-wrap gap-2">
                <Button
                    disabled={!canManage || submitting || selected.length === 0 || !destinationUuid}
                    onClick={() => void startSelected()}
                >
                    {submitting
                        ? 'Démarrage…'
                        : selected.length === 0
                            ? 'Démarrer la sélection'
                            : `Démarrer ${selected.length} dépôt${selected.length > 1 ? 's' : ''}`}
                </Button>
                <Button variant="ghost" disabled={submitting} onClick={onSkip}>
                    Passer
                </Button>
            </div>
        </Card>
    );
}
