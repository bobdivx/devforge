import { Database, LoaderCircle } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Modal } from '../ui/Modal';
import {
    domainApi,
    type CreateDatabaseInput,
    type CoreResource,
    type DatabaseEngine,
    type DeploymentTarget,
    type Environment,
    type Project,
    type TursoMigrationCandidate,
} from '../../lib/domain-api';

const engines: Array<{ value: DatabaseEngine; label: string; description: string }> = [
    { value: 'libsql', label: 'libSQL (Turso OSS)', description: 'SQLite distribué, compatible client Turso/libsql.' },
    { value: 'postgresql', label: 'PostgreSQL', description: 'Relationnel, recommandé pour la plupart des apps.' },
    { value: 'mysql', label: 'MySQL', description: 'Relationnel, compatible LAMP/WordPress.' },
    { value: 'mariadb', label: 'MariaDB', description: 'Fork MySQL, souvent utilisé en production.' },
    { value: 'mongodb', label: 'MongoDB', description: 'Document NoSQL.' },
    { value: 'redis', label: 'Redis', description: 'Cache et files d’attente en mémoire.' },
    { value: 'keydb', label: 'KeyDB', description: 'Alternative Redis multithreadée.' },
    { value: 'dragonfly', label: 'Dragonfly', description: 'Alternative Redis haute performance.' },
    { value: 'clickhouse', label: 'ClickHouse', description: 'Analytique et colonnes.' },
];

const engineHints: Partial<Record<DatabaseEngine, string>> = {
    libsql: 'libSQL utilise l’image officielle ghcr.io/tursodatabase/libsql-server. Connectez-vous avec l’URL libsql:// affichée dans le détail de la ressource.',
    postgresql: 'PostgreSQL sera accessible via DATABASE_URL sur le réseau Docker interne.',
};

function defaultEnvKeyForEngine(engine: DatabaseEngine): string {
    switch (engine) {
        case 'libsql':
            return 'LIBSQL_URL';
        case 'mongodb':
            return 'MONGODB_URI';
        case 'redis':
        case 'keydb':
        case 'dragonfly':
            return 'REDIS_URL';
        default:
            return 'DATABASE_URL';
    }
}

function readConfigUuid(configuration: Record<string, unknown>, key: string): string | null {
    const value = configuration[key];
    if (!value || typeof value !== 'object') {
        return null;
    }

    const uuid = (value as { uuid?: unknown }).uuid;
    return typeof uuid === 'string' ? uuid : null;
}

const postgresqlImages = [
    { value: 'postgres:18-alpine', label: 'PostgreSQL 18' },
    { value: 'postgres:17-alpine', label: 'PostgreSQL 17' },
    { value: 'postgres:16-alpine', label: 'PostgreSQL 16 (recommandé)' },
];

type Props = {
    open: boolean;
    onClose: () => void;
    onCreated: (databaseUuid: string) => void;
};

type DestinationOption = {
    destinationUuid: string;
    label: string;
};

export function CreateDatabaseModal({ open, onClose, onCreated }: Props) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [targets, setTargets] = useState<DeploymentTarget[]>([]);
    const [applications, setApplications] = useState<CoreResource[]>([]);
    const [tursoMigration, setTursoMigration] = useState<TursoMigrationCandidate | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({
        engine: 'libsql' as DatabaseEngine,
        project_uuid: '',
        environment_uuid: '',
        destination_uuid: '',
        application_uuid: '',
        env_key: 'LIBSQL_URL',
        name: '',
        image: 'postgres:16-alpine',
        instant_deploy: true,
        application_instant_deploy: true,
        migrate_from_remote: false,
    });

    useEffect(() => {
        if (!open) {
            return;
        }

        setError(null);

        Promise.all([
            domainApi.projects(),
            domainApi.deploymentTargets(),
            domainApi.coreResources('applications'),
        ])
            .then(([projectsResponse, targetsResponse, applicationsResponse]) => {
                const nextProjects = projectsResponse.data;
                const nextTargets = targetsResponse.data;
                const nextApplications = applicationsResponse.data;
                const firstProject = nextProjects[0];
                const firstEnvironment = firstProject?.environments?.[0];
                const firstDestination = nextTargets[0]?.destinations[0];

                setProjects(nextProjects);
                setTargets(nextTargets);
                setApplications(nextApplications);
                setForm({
                    engine: 'libsql',
                    project_uuid: firstProject?.uuid ?? '',
                    environment_uuid: firstEnvironment?.uuid ?? '',
                    destination_uuid: firstDestination?.uuid ?? '',
                    application_uuid: '',
                    env_key: 'LIBSQL_URL',
                    name: '',
                    image: 'postgres:16-alpine',
                    instant_deploy: true,
                    application_instant_deploy: true,
                    migrate_from_remote: false,
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
        destinationUuid: destination.uuid,
        label: `${server.name} / ${destination.name}`,
    }))), [targets]);

    const compatibleApplications = useMemo(() => applications.filter((application) => {
        if (!form.environment_uuid || !form.destination_uuid) {
            return false;
        }

        const environmentUuid = readConfigUuid(application.configuration, 'environment');
        const destinationUuid = readConfigUuid(application.configuration, 'destination');

        return environmentUuid === form.environment_uuid
            && destinationUuid === form.destination_uuid;
    }), [applications, form.environment_uuid, form.destination_uuid]);

    useEffect(() => {
        if (!open || form.application_uuid === '') {
            setTursoMigration(null);
            return;
        }

        domainApi.linkableDatabases(form.application_uuid)
            .then((response) => {
                setTursoMigration(response.meta?.turso_migration ?? null);
            })
            .catch(() => {
                setTursoMigration(null);
            });
    }, [open, form.application_uuid]);

    const selectedEngine = engines.find((engine) => engine.value === form.engine);
    const engineHint = engineHints[form.engine];

    const canSubmit = form.project_uuid !== ''
        && form.environment_uuid !== ''
        && form.destination_uuid !== ''
        && !submitting;

    const handleSubmit = async (event: Event) => {
        event.preventDefault();
        if (!canSubmit) {
            return;
        }

        setSubmitting(true);
        setError(null);

        const payload: CreateDatabaseInput = {
            engine: form.engine,
            project_uuid: form.project_uuid,
            environment_uuid: form.environment_uuid,
            destination_uuid: form.destination_uuid,
            instant_deploy: form.instant_deploy,
        };

        if (form.name.trim() !== '') {
            payload.name = form.name.trim();
        }

        if (form.engine === 'postgresql') {
            payload.image = form.image;
        }

        if (form.application_uuid !== '') {
            payload.application_uuid = form.application_uuid;
            payload.env_key = form.env_key;
            payload.application_instant_deploy = form.application_instant_deploy;
            if (form.migrate_from_remote) {
                payload.migrate_from_remote = true;
            }
        }

        try {
            const response = await domainApi.createDatabase(payload);
            onCreated(response.data.uuid);
            onClose();
        } catch (submitError: unknown) {
            setError(submitError instanceof Error ? submitError.message : 'La création a échoué.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            open={open}
            title="Nouvelle base de données"
            onClose={onClose}
            footer={(
                <>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={onClose} disabled={submitting}>
                        Annuler
                    </button>
                    <button class="btn btn-primary btn-sm" type="submit" form="create-database-form" disabled={!canSubmit}>
                        {submitting ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden /> : <Database class="size-3.5" aria-hidden />}
                        {submitting ? 'Création…' : 'Créer'}
                    </button>
                </>
            )}
        >
            <form id="create-database-form" class="grid gap-4" onSubmit={handleSubmit}>
                <p class="text-xs text-base-content/60">Déployez une instance gérée sur votre serveur Coolify.</p>
                {error && <p class="text-xs text-error" role="alert">{error}</p>}

                <label class="grid gap-1 text-sm">
                    <span class="font-medium">Moteur</span>
                    <select
                        class="select select-bordered select-sm w-full"
                        value={form.engine}
                        onChange={(event) => {
                            const engine = (event.target as HTMLSelectElement).value as DatabaseEngine;
                            setForm((current) => ({
                                ...current,
                                engine,
                                env_key: defaultEnvKeyForEngine(engine),
                            }));
                        }}
                    >
                        {engines.map((engine) => (
                            <option value={engine.value} key={engine.value}>{engine.label}</option>
                        ))}
                    </select>
                    {selectedEngine && <span class="text-xs text-base-content/55">{selectedEngine.description}</span>}
                </label>

                <label class="grid gap-1 text-sm">
                    <span class="font-medium">Projet</span>
                    <select
                        class="select select-bordered select-sm w-full"
                        value={form.project_uuid}
                        onChange={(event) => {
                            const projectUuid = (event.target as HTMLSelectElement).value;
                            const project = projects.find((item) => item.uuid === projectUuid);
                            const firstEnvironment = project?.environments?.[0];
                            setForm((current) => ({
                                ...current,
                                project_uuid: projectUuid,
                                environment_uuid: firstEnvironment?.uuid ?? '',
                                application_uuid: '',
                            }));
                        }}
                    >
                        {projects.length === 0 && <option value="">Aucun projet</option>}
                        {projects.map((project) => (
                            <option value={project.uuid} key={project.uuid}>{project.name}</option>
                        ))}
                    </select>
                </label>

                <label class="grid gap-1 text-sm">
                    <span class="font-medium">Environnement</span>
                    <select
                        class="select select-bordered select-sm w-full"
                        value={form.environment_uuid}
                        onChange={(event) => setForm((current) => ({
                            ...current,
                            environment_uuid: (event.target as HTMLSelectElement).value,
                            application_uuid: '',
                        }))}
                    >
                        {environments.length === 0 && <option value="">Aucun environnement</option>}
                        {environments.map((environment) => (
                            <option value={environment.uuid} key={environment.uuid}>{environment.name}</option>
                        ))}
                    </select>
                </label>

                <label class="grid gap-1 text-sm">
                    <span class="font-medium">Destination</span>
                    <select
                        class="select select-bordered select-sm w-full"
                        value={form.destination_uuid}
                        onChange={(event) => setForm((current) => ({
                            ...current,
                            destination_uuid: (event.target as HTMLSelectElement).value,
                            application_uuid: '',
                        }))}
                    >
                        {destinationOptions.length === 0 && <option value="">Aucun serveur disponible</option>}
                        {destinationOptions.map((destination) => (
                            <option value={destination.destinationUuid} key={destination.destinationUuid}>{destination.label}</option>
                        ))}
                    </select>
                </label>

                <label class="grid gap-1 text-sm">
                    <span class="font-medium">Application à rattacher (optionnel)</span>
                    <select
                        class="select select-bordered select-sm w-full"
                        value={form.application_uuid}
                        onChange={(event) => setForm((current) => ({
                            ...current,
                            application_uuid: (event.target as HTMLSelectElement).value,
                            migrate_from_remote: false,
                        }))}
                    >
                        <option value="">Aucune — créer la base seule</option>
                        {compatibleApplications.map((application) => (
                            <option value={application.uuid} key={application.uuid}>{application.name}</option>
                        ))}
                    </select>
                    {form.environment_uuid && form.destination_uuid && compatibleApplications.length === 0 && (
                        <span class="text-xs text-base-content/55">
                            Aucune application compatible dans cet environnement et sur cette destination.
                        </span>
                    )}
                </label>

                {form.application_uuid !== '' && (
                    <>
                        <label class="grid gap-1 text-sm">
                            <span class="font-medium">Variable d’environnement</span>
                            <input
                                class="input input-bordered input-sm w-full font-mono"
                                type="text"
                                value={form.env_key}
                                onInput={(event) => setForm((current) => ({
                                    ...current,
                                    env_key: (event.target as HTMLInputElement).value.toUpperCase(),
                                }))}
                            />
                        </label>

                        <label class="flex items-center gap-2 text-sm">
                            <input
                                class="checkbox checkbox-sm"
                                type="checkbox"
                                checked={form.application_instant_deploy}
                                onChange={(event) => setForm((current) => ({
                                    ...current,
                                    application_instant_deploy: (event.target as HTMLInputElement).checked,
                                }))}
                            />
                            <span>Redéployer l’application après rattachement</span>
                        </label>

                        {form.engine === 'libsql' && tursoMigration?.available && (
                            <>
                                <label class="flex items-center gap-2 text-sm">
                                    <input
                                        class="checkbox checkbox-sm"
                                        type="checkbox"
                                        checked={form.migrate_from_remote}
                                        onChange={(event) => setForm((current) => ({
                                            ...current,
                                            migrate_from_remote: (event.target as HTMLInputElement).checked,
                                        }))}
                                    />
                                    <span>Migrer les données depuis Turso</span>
                                </label>
                                <p class="text-xs text-base-content/55">
                                    Source détectée : <span class="font-mono">{tursoMigration.source_url}</span>
                                    {tursoMigration.env_keys.length > 0 && (
                                        <> ({tursoMigration.env_keys.join(' + ')})</>
                                    )}
                                    .
                                </p>
                            </>
                        )}
                    </>
                )}

                {form.engine === 'postgresql' && (
                    <label class="grid gap-1 text-sm">
                        <span class="font-medium">Version PostgreSQL</span>
                        <select
                            class="select select-bordered select-sm w-full"
                            value={form.image}
                            onChange={(event) => setForm((current) => ({
                                ...current,
                                image: (event.target as HTMLSelectElement).value,
                            }))}
                        >
                            {postgresqlImages.map((image) => (
                                <option value={image.value} key={image.value}>{image.label}</option>
                            ))}
                        </select>
                    </label>
                )}

                <label class="grid gap-1 text-sm">
                    <span class="font-medium">Nom (optionnel)</span>
                    <input
                        class="input input-bordered input-sm w-full"
                        type="text"
                        placeholder="Laisser vide pour un nom auto-généré"
                        value={form.name}
                        onInput={(event) => setForm((current) => ({
                            ...current,
                            name: (event.target as HTMLInputElement).value,
                        }))}
                    />
                </label>

                <label class="flex items-center gap-2 text-sm">
                    <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        checked={form.instant_deploy}
                        onChange={(event) => setForm((current) => ({
                            ...current,
                            instant_deploy: (event.target as HTMLInputElement).checked,
                        }))}
                    />
                    <span>Démarrer immédiatement après la création</span>
                </label>

                {engineHint && (
                    <p class="rounded-lg border border-base-300/70 bg-base-200/40 p-3 text-xs text-base-content/60">
                        {engineHint}
                    </p>
                )}
            </form>
        </Modal>
    );
}
