import { Save } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Modal } from '../ui/Modal';
import {
    domainApi,
    type CoreResource,
    type Environment,
    type Project,
    type SharedVariable,
    type SharedVariableInput,
    type SharedVariableUpdateInput,
} from '../../lib/domain-api';
import type { SharedVariableScopeTab } from '../../lib/shared-variables-routes';

type SharedVariableFormModalProps = {
    open: boolean;
    mode: 'create' | 'edit';
    scope: Exclude<SharedVariableScopeTab, 'overview'>;
    variable?: SharedVariable | null;
    onClose: () => void;
    onSubmit: (input: SharedVariableInput | SharedVariableUpdateInput) => Promise<void>;
};

function ScopeSelectors({
    scope,
    projects,
    servers,
    projectUuid,
    environmentUuid,
    serverUuid,
    onProjectUuidChange,
    onEnvironmentUuidChange,
    onServerUuidChange,
}: {
    scope: Exclude<SharedVariableScopeTab, 'overview'>;
    projects: Project[];
    servers: CoreResource[];
    projectUuid: string;
    environmentUuid: string;
    serverUuid: string;
    onProjectUuidChange: (value: string) => void;
    onEnvironmentUuidChange: (value: string) => void;
    onServerUuidChange: (value: string) => void;
}) {
    const environments = useMemo(() => {
        const project = projects.find((item) => item.uuid === projectUuid);
        return project?.environments ?? [];
    }, [projectUuid, projects]);

    if (scope === 'team') {
        return null;
    }

    return (
        <div class="grid gap-2">
            {(scope === 'project' || scope === 'environment') && (
                <label class="grid gap-1 text-xs">
                    <span>Projet</span>
                    <select
                        class="select select-bordered select-sm w-full"
                        required
                        value={projectUuid}
                        onChange={(event) => {
                            onProjectUuidChange(event.currentTarget.value);
                            onEnvironmentUuidChange('');
                        }}
                    >
                        <option value="">Sélectionner un projet</option>
                        {projects.map((project) => (
                            <option key={project.uuid} value={project.uuid}>{project.name}</option>
                        ))}
                    </select>
                </label>
            )}
            {scope === 'environment' && (
                <label class="grid gap-1 text-xs">
                    <span>Environnement</span>
                    <select
                        class="select select-bordered select-sm w-full"
                        required
                        value={environmentUuid}
                        onChange={(event) => onEnvironmentUuidChange(event.currentTarget.value)}
                    >
                        <option value="">Sélectionner un environnement</option>
                        {environments.map((environment: Environment) => (
                            <option key={environment.uuid} value={environment.uuid}>{environment.name}</option>
                        ))}
                    </select>
                </label>
            )}
            {scope === 'server' && (
                <label class="grid gap-1 text-xs">
                    <span>Serveur</span>
                    <select
                        class="select select-bordered select-sm w-full"
                        required
                        value={serverUuid}
                        onChange={(event) => onServerUuidChange(event.currentTarget.value)}
                    >
                        <option value="">Sélectionner un serveur</option>
                        {servers.map((server) => (
                            <option key={server.uuid} value={server.uuid}>{server.name}</option>
                        ))}
                    </select>
                </label>
            )}
        </div>
    );
}

export function SharedVariableFormModal({
    open,
    mode,
    scope,
    variable = null,
    onClose,
    onSubmit,
}: SharedVariableFormModalProps) {
    const [key, setKey] = useState('');
    const [value, setValue] = useState('');
    const [comment, setComment] = useState('');
    const [isMultiline, setIsMultiline] = useState(false);
    const [isLiteral, setIsLiteral] = useState(false);
    const [isShownOnce, setIsShownOnce] = useState(false);
    const [projectUuid, setProjectUuid] = useState('');
    const [environmentUuid, setEnvironmentUuid] = useState('');
    const [serverUuid, setServerUuid] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);
    const [servers, setServers] = useState<CoreResource[]>([]);

    useEffect(() => {
        if (!open) {
            return;
        }

        setKey(variable?.key ?? '');
        setValue('');
        setComment(variable?.comment ?? '');
        setIsMultiline(variable?.is_multiline ?? false);
        setIsLiteral(variable?.is_literal ?? false);
        setIsShownOnce(false);
        setProjectUuid(variable?.project_uuid ?? '');
        setEnvironmentUuid(variable?.environment_uuid ?? '');
        setServerUuid(variable?.server_uuid ?? '');
        setError(null);

        if (mode === 'create' && scope !== 'team') {
            void Promise.all([
                domainApi.projects().then((response) => setProjects(response.data)),
                scope === 'server'
                    ? domainApi.coreResources('servers').then((response) => setServers(response.data))
                    : Promise.resolve(),
            ]).catch(() => setError('Impossible de charger les ressources de rattachement.'));
        }
    }, [mode, open, scope, variable]);

    const valueLocked = mode === 'edit' && Boolean(variable?.value_locked);

    return (
        <Modal
            open={open}
            title={mode === 'create' ? 'Nouvelle variable' : `Modifier ${variable?.key ?? ''}`}
            onClose={onClose}
        >
            <form
                class="grid gap-3"
                onSubmit={async (event) => {
                    event.preventDefault();
                    setSaving(true);
                    setError(null);
                    try {
                        if (mode === 'create') {
                            await onSubmit({
                                key,
                                value: value || null,
                                scope,
                                comment: comment || null,
                                is_multiline: isMultiline,
                                is_literal: isLiteral,
                                is_shown_once: isShownOnce,
                                project_uuid: projectUuid || null,
                                environment_uuid: environmentUuid || null,
                                server_uuid: serverUuid || null,
                            } satisfies SharedVariableInput);
                        } else {
                            await onSubmit({
                                key,
                                value: value || null,
                                comment: comment || null,
                                is_multiline: isMultiline,
                                is_literal: isLiteral,
                            } satisfies SharedVariableUpdateInput);
                        }
                        onClose();
                    } catch (caught) {
                        setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
                    } finally {
                        setSaving(false);
                    }
                }}
            >
                <ScopeSelectors
                    scope={scope}
                    projects={projects}
                    servers={servers}
                    projectUuid={projectUuid}
                    environmentUuid={environmentUuid}
                    serverUuid={serverUuid}
                    onProjectUuidChange={setProjectUuid}
                    onEnvironmentUuidChange={setEnvironmentUuid}
                    onServerUuidChange={setServerUuid}
                />
                <label class="grid gap-1 text-xs">
                    <span>Clé</span>
                    <input
                        class="input input-bordered input-sm w-full font-mono"
                        required
                        maxLength={255}
                        value={key}
                        onInput={(event) => setKey(event.currentTarget.value)}
                    />
                </label>
                <label class="grid gap-1 text-xs">
                    <span>Valeur</span>
                    <textarea
                        class="textarea textarea-bordered textarea-sm w-full font-mono"
                        rows={isMultiline ? 5 : 2}
                        value={value}
                        disabled={valueLocked}
                        placeholder={valueLocked ? 'Secret verrouillé — supprimez et recréez pour changer la valeur.' : 'Laisser vide pour une valeur non définie'}
                        onInput={(event) => setValue(event.currentTarget.value)}
                    />
                </label>
                <label class="grid gap-1 text-xs">
                    <span>Commentaire</span>
                    <input
                        class="input input-bordered input-sm w-full"
                        maxLength={256}
                        value={comment}
                        onInput={(event) => setComment(event.currentTarget.value)}
                    />
                </label>
                <div class="flex flex-wrap gap-2 sm:gap-3 text-xs">
                    <label class="flex items-center gap-2">
                        <input class="checkbox checkbox-sm" type="checkbox" checked={isMultiline} onChange={(event) => setIsMultiline(event.currentTarget.checked)} />
                        Multiligne
                    </label>
                    <label class="flex items-center gap-2">
                        <input class="checkbox checkbox-sm" type="checkbox" checked={isLiteral} onChange={(event) => setIsLiteral(event.currentTarget.checked)} />
                        Littéral
                    </label>
                    {mode === 'create' && (
                        <label class="flex items-center gap-2">
                            <input class="checkbox checkbox-sm" type="checkbox" checked={isShownOnce} onChange={(event) => setIsShownOnce(event.currentTarget.checked)} />
                            Affichage unique
                        </label>
                    )}
                </div>
                {error && <p class="text-sm text-error">{error}</p>}
                <div class="form-actions">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>Annuler</button>
                    <button class="btn btn-primary btn-sm" type="submit" disabled={saving || key.trim() === ''}>
                        <Save class="size-3.5" aria-hidden />
                        {saving ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
