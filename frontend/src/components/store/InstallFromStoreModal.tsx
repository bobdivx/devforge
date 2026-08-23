import { useEffect, useMemo, useState } from 'preact/hooks';
import { Modal } from '../ui/Modal';
import { ConnectGithubButton } from '../github/ConnectGithubButton';
import { isGithubAppInstalled } from '../../lib/onboarding-github';
import {
    domainApi,
    type DeploymentTarget,
    type GithubAppSummary,
    type Project,
    type StoreListing,
} from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';

type Props = {
    open: boolean;
    listing: StoreListing | null;
    onClose: () => void;
    onInstalled: (applicationUuid: string) => void;
};

type DestinationOption = {
    destinationUuid: string;
    label: string;
};

export function InstallFromStoreModal({ open, listing, onClose, onInstalled }: Props) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [targets, setTargets] = useState<DeploymentTarget[]>([]);
    const [githubApps, setGithubApps] = useState<GithubAppSummary[]>([]);
    const [name, setName] = useState('');
    const [projectUuid, setProjectUuid] = useState('');
    const [environmentUuid, setEnvironmentUuid] = useState('');
    const [destinationUuid, setDestinationUuid] = useState('');
    const [githubAppUuid, setGithubAppUuid] = useState('');
    const [instantDeploy, setInstantDeploy] = useState(true);
    const [envValues, setEnvValues] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !listing) {
            return;
        }

        setName(listing.name);
        setEnvValues({});
        setError(null);

        let cancelled = false;
        void (async () => {
            try {
                const [projectsResponse, targetsResponse, appsResponse] = await Promise.all([
                    domainApi.projects(),
                    domainApi.deploymentTargets(),
                    domainApi.githubApps(),
                ]);
                if (cancelled) {
                    return;
                }

                const nextProjects = projectsResponse.data ?? [];
                const nextTargets = targetsResponse.data ?? [];
                const nextApps = (appsResponse.data ?? []).filter((app) => isGithubAppInstalled(app));
                setProjects(nextProjects);
                setTargets(nextTargets);
                setGithubApps(nextApps);

                const firstProject = nextProjects[0];
                setProjectUuid(firstProject?.uuid ?? '');
                setEnvironmentUuid(firstProject?.environments?.[0]?.uuid ?? '');
                const firstDestination = nextTargets[0]?.destinations[0]?.uuid ?? '';
                setDestinationUuid(firstDestination);
                setGithubAppUuid(nextApps[0]?.uuid ?? '');
            } catch (loadError) {
                if (!cancelled) {
                    setError(loadError instanceof ApiError ? loadError.message : 'Impossible de charger les cibles de déploiement.');
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [open, listing]);

    const environments = useMemo(
        () => projects.find((project) => project.uuid === projectUuid)?.environments ?? [],
        [projects, projectUuid],
    );

    const destinations = useMemo((): DestinationOption[] => {
        return targets.flatMap((server) => server.destinations.map((destination) => ({
            destinationUuid: destination.uuid,
            label: `${server.name} · ${destination.name}`,
        })));
    }, [targets]);

    const requiredVars = listing?.env_schema.filter((item) => item.required || item.is_secret) ?? [];

    const submit = async () => {
        if (!listing) {
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const response = await domainApi.installStoreListing(listing.slug, {
                name,
                project_uuid: projectUuid,
                environment_uuid: environmentUuid,
                destination_uuid: destinationUuid,
                github_app_uuid: githubAppUuid,
                instant_deploy: instantDeploy,
                env_values: envValues,
            });
            onInstalled(response.data.uuid);
            onClose();
        } catch (submitError) {
            setError(submitError instanceof ApiError ? submitError.message : 'L’installation a échoué.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            open={open}
            title={listing ? `Installer ${listing.name}` : 'Installer'}
            size="lg"
            onClose={onClose}
            footer={(
                <>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>Annuler</button>
                    <button
                        class="btn btn-primary btn-sm"
                        type="button"
                        disabled={submitting || !listing || !projectUuid || !destinationUuid || !githubAppUuid}
                        onClick={() => void submit()}
                    >
                        {submitting ? 'Installation…' : 'Installer'}
                    </button>
                </>
            )}
        >
            {!listing && <p class="text-sm text-base-content/55">Sélectionnez une application du Store.</p>}
            {listing && (
                <div class="grid gap-4">
                    <p class="text-sm text-base-content/65">
                        DevForge crée une nouvelle application à partir de <span class="font-mono">{listing.git_repository}</span>
                        {' '}({listing.git_branch}), applique les paramètres par défaut, puis déploie.
                    </p>
                    {error && <p class="text-sm text-error">{error}</p>}
                    <label class="grid gap-1 text-sm">
                        Nom de l’application
                        <input class="input input-bordered input-sm" value={name} onInput={(event) => setName(event.currentTarget.value)} />
                    </label>
                    <label class="grid gap-1 text-sm">
                        Projet
                        <select class="select select-bordered select-sm" value={projectUuid} onChange={(event) => {
                            const next = event.currentTarget.value;
                            setProjectUuid(next);
                            const project = projects.find((item) => item.uuid === next);
                            setEnvironmentUuid(project?.environments?.[0]?.uuid ?? '');
                        }}>
                            {projects.map((project) => (
                                <option key={project.uuid} value={project.uuid}>{project.name}</option>
                            ))}
                        </select>
                    </label>
                    <label class="grid gap-1 text-sm">
                        Environnement
                        <select class="select select-bordered select-sm" value={environmentUuid} onChange={(event) => setEnvironmentUuid(event.currentTarget.value)}>
                            {environments.map((environment) => (
                                <option key={environment.uuid} value={environment.uuid}>{environment.name}</option>
                            ))}
                        </select>
                    </label>
                    <label class="grid gap-1 text-sm">
                        Destination
                        <select class="select select-bordered select-sm" value={destinationUuid} onChange={(event) => setDestinationUuid(event.currentTarget.value)}>
                            {destinations.map((destination) => (
                                <option key={destination.destinationUuid} value={destination.destinationUuid}>{destination.label}</option>
                            ))}
                        </select>
                    </label>
                    <label class="grid gap-1 text-sm">
                        GitHub App
                        <select class="select select-bordered select-sm" value={githubAppUuid} onChange={(event) => setGithubAppUuid(event.currentTarget.value)}>
                            {githubApps.map((app) => (
                                <option key={app.uuid} value={app.uuid}>{app.name}</option>
                            ))}
                        </select>
                    </label>
                    {githubApps.length === 0 && <ConnectGithubButton />}
                    {requiredVars.length > 0 && (
                        <div class="grid gap-2 sm:gap-3 rounded-xl border border-base-300/70 p-3">
                            <p class="text-xs sm:text-sm font-medium">Variables à renseigner</p>
                            {requiredVars.map((item) => (
                                <label class="grid gap-1 text-sm" key={item.key}>
                                    <span class="font-mono text-xs">{item.key}{item.required ? ' *' : ''}</span>
                                    <input
                                        class="input input-bordered input-sm"
                                        type={item.is_secret ? 'password' : 'text'}
                                        placeholder={item.has_default ? 'Valeur par défaut déjà définie' : 'Valeur'}
                                        value={envValues[item.key] ?? ''}
                                        onInput={(event) => setEnvValues((current) => ({ ...current, [item.key]: event.currentTarget.value }))}
                                    />
                                    {item.description && <span class="text-xs text-base-content/50">{item.description}</span>}
                                </label>
                            ))}
                        </div>
                    )}
                    <label class="label cursor-pointer justify-start gap-2">
                        <input
                            class="checkbox checkbox-sm"
                            type="checkbox"
                            checked={instantDeploy}
                            onChange={(event) => setInstantDeploy(event.currentTarget.checked)}
                        />
                        <span class="label-text text-sm">Déployer immédiatement</span>
                    </label>
                </div>
            )}
        </Modal>
    );
}
