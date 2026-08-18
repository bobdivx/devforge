import { FolderGit2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import {
    domainApi,
    type DeploymentTarget,
    type GithubAppSummary,
    type Project,
} from '../../lib/domain-api';
import {
    createInitialDeployItems,
    markDeployItemCreated,
    markDeployItemCreating,
    markDeployItemFailed,
    mergeOnboardingDeployStatus,
    type OnboardingDeployItem,
} from '../../lib/onboarding-deploy';
import {
    firstDestinationUuid,
    firstProjectEnvironment,
    isGithubAppInstalled,
} from '../../lib/onboarding-github';
import type { PickedGithubRepository } from '../../lib/github-repo-picker';
import { useApiQuery } from '../../lib/use-api-query';
import { ConnectGithubButton } from '../github/ConnectGithubButton';
import { GithubRepoPicker } from '../github/GithubRepoPicker';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { OnboardingDeployProgress } from './OnboardingDeployProgress';

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
                apps={installed}
                canManage={canManage}
                onSkip={onSkip}
                onStarted={onConnected}
                onRefreshApps={() => void apps.reload()}
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
                                    <FolderGit2 class="size-4 text-primary" aria-hidden />
                                    <p class="text-sm font-semibold">{app.display_name ?? app.name}</p>
                                    <StatusBadge label="À installer sur GitHub" tone="warning" />
                                </div>
                                {canManage && <InstallButton app={app} />}
                            </li>
                        ))}
                    </ul>
                )}
            </DataState>
            {canManage && (
                <div class="mt-4">
                    <ConnectGithubButton
                        fromOnboarding
                        returnTo="onboarding"
                        label={pending.length > 0 ? 'Relancer la configuration GitHub' : 'Continuer avec GitHub'}
                    />
                </div>
            )}
            <div class="mt-4">
                <Button variant="ghost" onClick={onSkip}>Plus tard</Button>
            </div>
        </Card>
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
    apps,
    canManage,
    onSkip,
    onStarted,
    onRefreshApps,
}: {
    apps: GithubAppSummary[];
    canManage: boolean;
    onSkip: () => void;
    onStarted: () => void;
    onRefreshApps: () => void;
}) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [targets, setTargets] = useState<DeploymentTarget[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<PickedGithubRepository[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [deployItems, setDeployItems] = useState<OnboardingDeployItem[]>([]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        Promise.all([
            domainApi.projects(),
            domainApi.deploymentTargets(),
        ])
            .then(([projectsResponse, targetsResponse]) => {
                if (cancelled) {
                    return;
                }
                setProjects(projectsResponse.data);
                setTargets(targetsResponse.data);
            })
            .catch((loadError: unknown) => {
                if (!cancelled) {
                    setError(loadError instanceof Error ? loadError.message : 'Impossible de charger le contexte de déploiement.');
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
    }, []);

    const destinationUuid = firstDestinationUuid(targets);

    const createdUuids = deployItems
        .map((item) => item.uuid)
        .filter((uuid): uuid is string => uuid !== null)
        .sort()
        .join(',');

    useEffect(() => {
        if (createdUuids === '') {
            return;
        }

        let cancelled = false;
        let timer: number | null = null;

        const poll = async () => {
            try {
                const [deployments, applications] = await Promise.all([
                    domainApi.deployments(1, undefined, 50),
                    domainApi.coreResources('applications'),
                ]);
                if (cancelled) {
                    return;
                }

                let nextItems: OnboardingDeployItem[] = [];
                setDeployItems((current) => {
                    nextItems = mergeOnboardingDeployStatus(current, deployments.data, applications.data);

                    return nextItems;
                });

                const keepPolling = nextItems.some((item) => item.phase !== 'healthy' && item.phase !== 'failed');

                if (!cancelled && keepPolling) {
                    timer = window.setTimeout(() => {
                        void poll();
                    }, 2500);
                }
            } catch {
                if (!cancelled) {
                    timer = window.setTimeout(() => {
                        void poll();
                    }, 4000);
                }
            }
        };

        void poll();

        return () => {
            cancelled = true;
            if (timer !== null) {
                window.clearTimeout(timer);
            }
        };
    }, [createdUuids]);

    const startSelected = async () => {
        if (selected.length === 0) {
            return;
        }

        const chosen = selected;
        setDeployItems(createInitialDeployItems(chosen));
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

            for (const repository of chosen) {
                setDeployItems((current) => markDeployItemCreating(current, repository.id));
                try {
                    const created = await domainApi.createApplication({
                        project_uuid: launch.projectUuid,
                        environment_uuid: launch.environmentUuid,
                        destination_uuid: destinationUuid,
                        github_app_uuid: repository.github_app_uuid,
                        git_repository: repository.full_name,
                        repository_id: repository.id,
                        git_branch: repository.default_branch || 'main',
                        build_pack: 'nixpacks',
                        name: repository.name,
                        instant_deploy: true,
                    });
                    setDeployItems((current) => markDeployItemCreated(current, repository.id, created.data.uuid));
                } catch (createError: unknown) {
                    setDeployItems((current) => markDeployItemFailed(
                        current,
                        repository.id,
                        createError instanceof Error ? createError.message : 'Impossible de créer l’application.',
                    ));
                }
            }
        } catch (startError: unknown) {
            setError(startError instanceof Error ? startError.message : 'Impossible de démarrer les applications.');
            setDeployItems([]);
        } finally {
            setSubmitting(false);
        }
    };

    if (deployItems.length > 0) {
        return (
            <OnboardingDeployProgress
                items={deployItems}
                onContinue={onStarted}
            />
        );
    }

    return (
        <Card title="Choisir les dépôts" eyebrow="GitHub connecté">
            <p class="text-sm text-base-content/65">
                Choisissez une organisation, puis les dépôts à créer comme applications DevForge. Ils seront déployés
                tout de suite sur le premier serveur disponible.
            </p>
            <div class="mt-3">
                <GithubRepoPicker
                    apps={apps}
                    mode="multiple"
                    selected={selected}
                    onChange={setSelected}
                    canManage={canManage && !submitting}
                    disabled={submitting}
                    fromOnboarding
                    returnTo="onboarding"
                    onRefreshApps={onRefreshApps}
                    onError={setError}
                />
            </div>
            {!destinationUuid && !loading && (
                <p class="mt-3 text-xs text-warning">
                    Aucun serveur Docker n’est encore prêt. Vous pourrez démarrer ces dépôts après l’étape serveur.
                </p>
            )}
            {error && <p class="mt-3 text-xs text-error" role="alert">{error}</p>}
            <div class="mt-4 grid gap-2">
                <Button
                    disabled={!canManage || submitting || selected.length === 0 || !destinationUuid}
                    onClick={() => void startSelected()}
                >
                    {submitting
                        ? 'Démarrage…'
                        : selected.length === 0
                            ? 'Continuer →'
                            : `Démarrer ${selected.length} dépôt${selected.length > 1 ? 's' : ''}`}
                </Button>
                <Button variant="ghost" disabled={submitting} onClick={onSkip}>
                    Synchroniser plus tard
                </Button>
            </div>
        </Card>
    );
}
