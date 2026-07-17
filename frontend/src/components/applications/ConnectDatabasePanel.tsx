import { Database, ExternalLink, Eye, Link2, LoaderCircle, Plus } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
    domainApi,
    type ApplicationDatabaseConnection,
    type LinkableDatabase,
    type TursoMigrationCandidate,
} from '../../lib/domain-api';
import { navigateTo } from '../../lib/use-navigate';

type Props = {
    applicationUuid: string;
    canAct: boolean;
    onConnected: () => Promise<void>;
};

export function ConnectDatabasePanel({ applicationUuid, canAct, onConnected }: Props) {
    const [databases, setDatabases] = useState<LinkableDatabase[]>([]);
    const [connections, setConnections] = useState<ApplicationDatabaseConnection[]>([]);
    const [tursoMigration, setTursoMigration] = useState<TursoMigrationCandidate | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showAttachForm, setShowAttachForm] = useState(false);
    const [form, setForm] = useState({
        database_uuid: '',
        env_key: '',
        is_runtime: true,
        is_buildtime: true,
        instant_deploy: true,
        migrate_from_remote: false,
    });

    const linkableDatabases = useMemo(
        () => databases.filter((database) => database.is_linkable),
        [databases],
    );

    const databaseOptionLabel = (database: LinkableDatabase) => {
        const baseLabel = `${database.name} (${database.engine})`;
        const attachedApplications = database.connected_applications ?? [];

        if (attachedApplications.length === 0) {
            return baseLabel;
        }

        const applicationNames = attachedApplications.map((application) => application.application_name).join(', ');

        return `${baseLabel} — rattachée à ${applicationNames}`;
    };

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await domainApi.linkableDatabases(applicationUuid);
            const nextDatabases = response.data;
            const firstLinkableDatabase = nextDatabases.find((database) => database.is_linkable);
            setDatabases(nextDatabases);
            setConnections(response.meta?.connections ?? []);
            setTursoMigration(response.meta?.turso_migration ?? null);
            setShowAttachForm((response.meta?.connections ?? []).length === 0);
            setForm((current) => ({
                ...current,
                database_uuid: current.database_uuid && nextDatabases.some((db) => db.uuid === current.database_uuid && db.is_linkable)
                    ? current.database_uuid
                    : firstLinkableDatabase?.uuid ?? nextDatabases[0]?.uuid ?? '',
                env_key: current.env_key || firstLinkableDatabase?.default_env_key || 'DATABASE_URL',
                migrate_from_remote: response.meta?.turso_migration?.available ? current.migrate_from_remote : false,
            }));
        } catch (loadError: unknown) {
            setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les bases disponibles.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, [applicationUuid]);

    const selectedDatabase = useMemo(
        () => linkableDatabases.find((database) => database.uuid === form.database_uuid) ?? null,
        [linkableDatabases, form.database_uuid],
    );

    const connectionLabel = (connection: ApplicationDatabaseConnection) => {
        const database = databases.find((item) => item.uuid === connection.database_uuid);
        return database?.name ?? connection.database_uuid;
    };

    const handleSubmit = async (event: Event) => {
        event.preventDefault();
        if (!canAct || !form.database_uuid || submitting) {
            return;
        }

        setSubmitting(true);
        setError(null);
        setSuccess(null);

        try {
            const response = await domainApi.connectDatabase(applicationUuid, {
                database_uuid: form.database_uuid,
                env_key: form.env_key || undefined,
                is_runtime: form.is_runtime,
                is_buildtime: form.is_buildtime,
                instant_deploy: form.instant_deploy,
                migrate_from_remote: form.migrate_from_remote || undefined,
            });

            const { env_key, env_keys, database_name, deployment, migration } = response.data;
            const keysLabel = env_keys && env_keys.length > 1 ? env_keys.join(' + ') : env_key;
            const migrationLabel = migration?.performed ? ' Données migrées depuis Turso.' : '';
            setSuccess(
                deployment?.queued
                    ? `« ${keysLabel} » configurée avec « ${database_name} ». Redéploiement lancé.${migrationLabel}`
                    : `« ${keysLabel} » configurée avec « ${database_name} ».${migrationLabel}`,
            );
            await load();
            await onConnected();
        } catch (submitError: unknown) {
            setError(submitError instanceof Error ? submitError.message : 'Le rattachement a échoué.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="flex items-center justify-between gap-3 border-b border-base-300/70 px-5 py-4">
                <div>
                    <p class="text-sm font-semibold">Bases de données</p>
                    <p class="text-xs text-base-content/50">
                        {connections.length > 0
                            ? 'Cette application utilise déjà une ou plusieurs bases.'
                            : 'Rattacher une base du même environnement et serveur'}
                    </p>
                </div>
                <Database class="size-4 text-base-content/35" aria-hidden />
            </div>

            <div class="grid gap-4 p-5">
                {loading && <p class="text-sm text-base-content/55">Chargement des bases disponibles…</p>}

                {!loading && databases.length === 0 && connections.length === 0 && (
                    <div class="grid gap-3">
                        <p class="text-sm text-base-content/55">
                            Aucune base compatible. Créez-en une dans le même environnement et sur la même destination que l’application.
                        </p>
                        <a class="btn btn-outline btn-sm w-fit" href="/devforge/databases/">
                            <Plus class="size-3.5" aria-hidden />
                            Créer une base de données
                        </a>
                    </div>
                )}

                {!loading && databases.length > 0 && linkableDatabases.length === 0 && (
                    <p class="text-sm text-base-content/55">
                        Toutes les bases compatibles sont déjà rattachées à une application.
                    </p>
                )}

                {!loading && connections.length > 0 && (
                    <div class="grid gap-2">
                        <p class="text-xs font-medium uppercase tracking-wide text-base-content/45">Connexions actives</p>
                        <ul class="grid gap-2">
                            {connections.map((connection) => (
                                <li
                                    class="rounded-xl border border-success/25 bg-success/5 px-3 py-3 text-sm"
                                    key={connection.database_uuid}
                                >
                                    <div class="flex flex-wrap items-center gap-2">
                                        <span class="badge badge-success badge-xs">Rattachée</span>
                                        <span class="font-medium">{connectionLabel(connection)}</span>
                                        {databases.find((item) => item.uuid === connection.database_uuid)?.engine && (
                                            <span class="badge badge-ghost badge-xs uppercase">
                                                {databases.find((item) => item.uuid === connection.database_uuid)?.engine}
                                            </span>
                                        )}
                                    </div>
                                    <p class="mt-1 flex flex-wrap gap-1 font-mono text-[11px] text-base-content/55">
                                        {connection.env_keys.map((envKey) => (
                                            <span class="rounded bg-base-100 px-1.5 py-0.5" key={envKey}>{envKey}</span>
                                        ))}
                                    </p>
                                    <p class="mt-1 text-[11px] text-base-content/45">
                                        {connection.is_runtime ? 'Runtime' : ''}
                                        {connection.is_runtime && connection.is_buildtime ? ' · ' : ''}
                                        {connection.is_buildtime ? 'Build' : ''}
                                    </p>
                                    <div class="action-toolbar mt-3">
                                        <button
                                            class="btn btn-primary btn-sm"
                                            type="button"
                                            onClick={() => navigateTo(`/databases?uuid=${encodeURIComponent(connection.database_uuid)}&tab=data`)}
                                        >
                                            <Eye class="size-3.5" aria-hidden />
                                            Voir les données
                                        </button>
                                        <button
                                            class="btn btn-outline btn-sm"
                                            type="button"
                                            onClick={() => navigateTo(`/databases?uuid=${encodeURIComponent(connection.database_uuid)}`)}
                                        >
                                            <ExternalLink class="size-3.5" aria-hidden />
                                            Ouvrir la base
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                        {linkableDatabases.length === 0 && (
                            <p class="text-xs text-base-content/55">
                                Aucune autre base compatible n’est disponible pour un second rattachement.
                            </p>
                        )}
                    </div>
                )}

                {!loading && connections.length > 0 && linkableDatabases.length > 0 && canAct && !showAttachForm && (
                    <button
                        class="btn btn-outline btn-sm w-fit"
                        type="button"
                        onClick={() => setShowAttachForm(true)}
                    >
                        <Plus class="size-3.5" aria-hidden />
                        Rattacher une autre base
                    </button>
                )}

                {!loading && databases.length > 0 && canAct && showAttachForm && (
                    <form class="grid gap-3" onSubmit={handleSubmit}>
                        <label class="grid gap-1 text-sm">
                            <span class="font-medium">Base à rattacher</span>
                            <select
                                class="select select-bordered select-sm w-full"
                                value={form.database_uuid}
                                disabled={linkableDatabases.length === 0}
                                onChange={(event) => {
                                    const databaseUuid = (event.target as HTMLSelectElement).value;
                                    const database = linkableDatabases.find((item) => item.uuid === databaseUuid);
                                    if (!database) {
                                        return;
                                    }

                                    setForm((current) => ({
                                        ...current,
                                        database_uuid: databaseUuid,
                                        env_key: database.default_env_key ?? current.env_key,
                                    }));
                                }}
                            >
                                {databases.map((database) => (
                                    <option
                                        value={database.uuid}
                                        key={database.uuid}
                                        disabled={!database.is_linkable}
                                    >
                                        {databaseOptionLabel(database)}
                                    </option>
                                ))}
                            </select>
                        </label>

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
                            {selectedDatabase && selectedDatabase.engine === 'libsql' && (
                                <span class="text-xs text-base-content/55">
                                    Par défaut : paire Turso (<span class="font-mono">TURSO_DATABASE_URL</span> + <span class="font-mono">TURSO_AUTH_TOKEN</span>).
                                    Si votre app utilise déjà ces variables, elles seront mises à jour automatiquement.
                                </span>
                            )}
                            {selectedDatabase && selectedDatabase.engine !== 'libsql' && (
                                <span class="text-xs text-base-content/55">
                                    Suggestion : {selectedDatabase.default_env_key}
                                </span>
                            )}
                        </label>

                        <div class="flex flex-wrap gap-4 text-sm">
                            <label class="flex items-center gap-2">
                                <input
                                    class="checkbox checkbox-sm"
                                    type="checkbox"
                                    checked={form.is_runtime}
                                    onChange={(event) => setForm((current) => ({
                                        ...current,
                                        is_runtime: (event.target as HTMLInputElement).checked,
                                    }))}
                                />
                                <span>Runtime</span>
                            </label>
                            <label class="flex items-center gap-2">
                                <input
                                    class="checkbox checkbox-sm"
                                    type="checkbox"
                                    checked={form.is_buildtime}
                                    onChange={(event) => setForm((current) => ({
                                        ...current,
                                        is_buildtime: (event.target as HTMLInputElement).checked,
                                    }))}
                                />
                                <span>Build time</span>
                            </label>
                            <label class="flex items-center gap-2">
                                <input
                                    class="checkbox checkbox-sm"
                                    type="checkbox"
                                    checked={form.instant_deploy}
                                    onChange={(event) => setForm((current) => ({
                                        ...current,
                                        instant_deploy: (event.target as HTMLInputElement).checked,
                                    }))}
                                />
                                <span>Redéployer après rattachement</span>
                            </label>
                            {tursoMigration?.available && selectedDatabase?.engine === 'libsql' && (
                                <label class="flex items-center gap-2">
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
                            )}
                        </div>

                        {tursoMigration?.available && selectedDatabase?.engine === 'libsql' && (
                            <p class="text-xs text-base-content/55">
                                Source détectée : <span class="font-mono">{tursoMigration.source_url}</span>
                                {tursoMigration.env_keys.length > 0 && (
                                    <> ({tursoMigration.env_keys.join(' + ')})</>
                                )}
                                . Les données seront importées avant la mise à jour des variables.
                            </p>
                        )}

                        <div class="action-toolbar">
                        <button class="btn btn-primary btn-sm w-fit sm:w-auto" type="submit" disabled={submitting || !form.database_uuid || linkableDatabases.length === 0}>
                            {submitting
                                ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                : <Link2 class="size-3.5" aria-hidden />}
                            {submitting ? 'Rattachement…' : 'Rattacher la base'}
                        </button>
                        {connections.length > 0 && (
                            <button
                                class="btn btn-ghost btn-sm w-fit"
                                type="button"
                                onClick={() => setShowAttachForm(false)}
                            >
                                Annuler
                            </button>
                        )}
                        </div>
                    </form>
                )}

                {error && <p class="text-xs text-error" role="alert">{error}</p>}
                {success && <p class="text-xs text-success" role="status">{success}</p>}
            </div>
        </section>
    );
}
