import {
    ChevronRight,
    ExternalLink,
    FileText,
    Folder,
    FolderOpen,
    GitBranch,
    GitPullRequest,
    RefreshCw,
    Save,
} from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
    domainApi,
    type ApplicationSourceEntry,
    type ApplicationSourceInfo,
    type ApplicationSourceListing,
} from '../../lib/domain-api';
import { DataState } from '../ui/DataState';
import { Card } from '../ui/Card';

type Props = {
    applicationUuid: string;
};

type WriteMode = 'direct' | 'pull_request';

function entryIcon(entry: ApplicationSourceEntry) {
    return entry.type === 'directory' ? Folder : FileText;
}

function formatBytes(size: number): string {
    if (size < 1024) {
        return `${size} o`;
    }

    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} Ko`;
    }

    return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function breadcrumbSegments(path: string): string[] {
    if (path === '') {
        return [''];
    }

    const parts = path.split('/').filter(Boolean);
    const segments: string[] = [''];

    for (let index = 0; index < parts.length; index += 1) {
        segments.push(parts.slice(0, index + 1).join('/'));
    }

    return segments;
}

export function ApplicationSourceExplorer({ applicationUuid }: Props) {
    const [info, setInfo] = useState<ApplicationSourceInfo | null>(null);
    const [listing, setListing] = useState<ApplicationSourceListing | null>(null);
    const [currentPath, setCurrentPath] = useState('');
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [editorValue, setEditorValue] = useState('');
    const [savedContent, setSavedContent] = useState('');
    const [fileSha, setFileSha] = useState<string | null>(null);
    const [commitMessage, setCommitMessage] = useState('');
    const [writeMode, setWriteMode] = useState<WriteMode>('direct');
    const [redeployAfterCommit, setRedeployAfterCommit] = useState(true);
    const [lastCommitUrl, setLastCommitUrl] = useState<string | null>(null);
    const [lastPullRequestUrl, setLastPullRequestUrl] = useState<string | null>(null);
    const [lastDeploymentUuid, setLastDeploymentUuid] = useState<string | null>(null);
    const [loadingInfo, setLoadingInfo] = useState(true);
    const [loadingListing, setLoadingListing] = useState(false);
    const [loadingFile, setLoadingFile] = useState(false);
    const [savingFile, setSavingFile] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [truncatedRead, setTruncatedRead] = useState(false);

    const breadcrumbs = useMemo(() => breadcrumbSegments(currentPath), [currentPath]);
    const isDirty = selectedPath !== null && editorValue !== savedContent;
    const canSave = isDirty && !truncatedRead && commitMessage.trim() !== '' && !savingFile && !loadingFile;

    const loadInfo = async () => {
        setLoadingInfo(true);
        setError(null);

        try {
            const response = await domainApi.applicationSourceInfo(applicationUuid);
            setInfo(response.data);
            setCurrentPath(response.data.initial_path ?? '');
        } catch (loadError: unknown) {
            setError(loadError);
        } finally {
            setLoadingInfo(false);
        }
    };

    const loadDirectory = async (path: string) => {
        if (!info?.available) {
            return;
        }

        setLoadingListing(true);
        setError(null);

        try {
            const response = await domainApi.listApplicationSourceDirectory(applicationUuid, path);
            setListing(response.data);
            setCurrentPath(response.data.path);
            setSelectedPath(null);
            setEditorValue('');
            setSavedContent('');
            setFileSha(null);
            setCommitMessage('');
            setLastCommitUrl(null);
            setLastPullRequestUrl(null);
            setLastDeploymentUuid(null);
        } catch (loadError: unknown) {
            setError(loadError);
        } finally {
            setLoadingListing(false);
        }
    };

    const openFile = async (path: string) => {
        setLoadingFile(true);
        setError(null);

        try {
            const response = await domainApi.readApplicationSourceFile(applicationUuid, path);
            setSelectedPath(response.data.path);
            setEditorValue(response.data.content);
            setSavedContent(response.data.content);
            setFileSha(response.data.sha);
            setCommitMessage('');
            setLastCommitUrl(null);
            setLastPullRequestUrl(null);
            setLastDeploymentUuid(null);
            setTruncatedRead(response.data.truncated);
        } catch (loadError: unknown) {
            setSelectedPath(null);
            setFileSha(null);
            setError(loadError);
        } finally {
            setLoadingFile(false);
        }
    };

    const saveFile = async () => {
        if (!selectedPath || !canSave) {
            return;
        }

        setSavingFile(true);
        setError(null);

        try {
            const response = await domainApi.writeApplicationSourceFile(applicationUuid, {
                path: selectedPath,
                content: editorValue,
                commit_message: commitMessage.trim(),
                sha: fileSha,
                mode: writeMode,
                redeploy: writeMode === 'direct' ? redeployAfterCommit : false,
            });

            setSavedContent(editorValue);
            setFileSha(response.data.sha);
            setCommitMessage('');
            setLastCommitUrl(response.data.commit_url);
            setLastPullRequestUrl(response.data.pull_request_url ?? null);
            setLastDeploymentUuid(response.data.redeploy?.deployment_uuid ?? null);
        } catch (saveError: unknown) {
            setError(saveError);
        } finally {
            setSavingFile(false);
        }
    };

    const openEntry = async (entry: ApplicationSourceEntry) => {
        if (entry.type === 'directory') {
            await loadDirectory(entry.path);
            return;
        }

        await openFile(entry.path);
    };

    useEffect(() => {
        void loadInfo();
    }, [applicationUuid]);

    useEffect(() => {
        if (info?.available) {
            void loadDirectory(info.initial_path ?? '');
        }
    }, [info?.available, info?.initial_path, applicationUuid]);

    const saveLabel = savingFile
        ? (writeMode === 'pull_request' ? 'PR…' : 'Commit…')
        : (writeMode === 'pull_request' ? 'Ouvrir PR' : 'Commit Git');

    return (
        <Card title="Code source Git">
            <div class="grid gap-4">
                <p class="text-sm text-base-content/60">
                    Fichiers du dépôt Git déployé (comme dans Cursor/VS Code), pas la configuration DevForge
                    (<span class="font-mono text-xs">docker-compose.yaml</span>, <span class="font-mono text-xs">.env</span>).
                </p>

                <DataState loading={loadingInfo} error={error} onRetry={() => void loadInfo()}>
                    {info && !info.available && (
                        <div class="rounded-xl border border-dashed border-base-300/80 bg-base-100/60 px-5 py-8 text-sm text-base-content/60">
                            {info.reason ?? 'Source Git indisponible pour cette application.'}
                        </div>
                    )}

                    {info?.available && (
                        <>
                            <div class="flex flex-wrap items-center justify-between gap-3">
                                <div class="flex flex-wrap items-center gap-2 text-xs text-base-content/55">
                                    <span class="inline-flex items-center gap-1 rounded-full bg-base-200 px-2 py-1 font-mono">
                                        <GitBranch class="size-3.5" aria-hidden />
                                        {info.owner}/{info.repo} @ {info.git_branch}
                                    </span>
                                    {info.html_url && (
                                        <a
                                            class="btn btn-ghost btn-xs"
                                            href={info.html_url}
                                            rel="noreferrer"
                                            target="_blank"
                                        >
                                            <ExternalLink class="size-3.5" aria-hidden />
                                            Ouvrir sur GitHub
                                        </a>
                                    )}
                                </div>
                                <button
                                    class="btn btn-ghost btn-sm"
                                    type="button"
                                    onClick={() => void loadDirectory(currentPath)}
                                    disabled={loadingListing}
                                >
                                    <RefreshCw class={`size-3.5 ${loadingListing ? 'animate-spin' : ''}`} aria-hidden />
                                    Actualiser
                                </button>
                            </div>

                            <div class="flex flex-wrap items-center gap-2 text-xs text-base-content/55">
                                {breadcrumbs.map((segment, index) => (
                                    <span key={segment || 'root'} class="inline-flex items-center gap-2">
                                        {index > 0 && <ChevronRight class="size-3" aria-hidden />}
                                        <button
                                            class={`font-mono hover:text-primary ${segment === currentPath ? 'text-base-content font-medium' : ''}`}
                                            type="button"
                                            onClick={() => void loadDirectory(segment)}
                                        >
                                            {segment === '' ? '(racine)' : segment}
                                        </button>
                                    </span>
                                ))}
                            </div>

                            <div class="grid gap-2.5 sm:gap-3 md:gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
                                <div class="rounded-xl border border-base-300/70 bg-base-100/50">
                                    <div class="border-b border-base-300/60 px-3 py-2 text-xs font-medium uppercase tracking-wide text-base-content/45">
                                        {listing?.entry_count ?? 0} élément(s)
                                    </div>
                                    <ul class="max-h-[28rem] overflow-y-auto p-2">
                                        {listing?.parent_path !== null && listing?.parent_path !== undefined && (
                                            <li>
                                                <button
                                                    class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-base-200/70"
                                                    type="button"
                                                    onClick={() => void loadDirectory(listing.parent_path ?? '')}
                                                >
                                                    <FolderOpen class="size-3.5 sm:size-4 shrink-0 text-warning" aria-hidden />
                                                    ..
                                                </button>
                                            </li>
                                        )}
                                        {(listing?.entries ?? []).map((entry) => {
                                            const Icon = entryIcon(entry);

                                            return (
                                                <li key={entry.path}>
                                                    <button
                                                        class={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-base-200/70 ${
                                                            selectedPath === entry.path ? 'bg-primary/10 text-primary' : ''
                                                        }`}
                                                        type="button"
                                                        onClick={() => void openEntry(entry)}
                                                    >
                                                        <Icon class="mt-0.5 size-3.5 sm:size-4 shrink-0" aria-hidden />
                                                        <span class="min-w-0 flex-1">
                                                            <span class="block truncate font-medium">{entry.name}</span>
                                                            <span class="block text-[11px] text-base-content/45">
                                                                {entry.type === 'directory' ? 'dossier' : formatBytes(entry.size)}
                                                            </span>
                                                        </span>
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>

                                <div class="grid gap-2">
                                    <div class="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <p class="text-xs sm:text-sm font-semibold">
                                                {selectedPath ? (isDirty ? 'Édition' : 'Lecture') : 'Sélectionnez un fichier'}
                                            </p>
                                            {selectedPath && (
                                                <p class="font-mono text-[11px] text-base-content/45">{selectedPath}</p>
                                            )}
                                        </div>
                                        {selectedPath && !truncatedRead && (
                                            <button
                                                class="btn btn-primary btn-sm"
                                                type="button"
                                                onClick={() => void saveFile()}
                                                disabled={!canSave}
                                            >
                                                {writeMode === 'pull_request' ? (
                                                    <GitPullRequest class={`size-3.5 ${savingFile ? 'animate-pulse' : ''}`} aria-hidden />
                                                ) : (
                                                    <Save class={`size-3.5 ${savingFile ? 'animate-pulse' : ''}`} aria-hidden />
                                                )}
                                                {saveLabel}
                                            </button>
                                        )}
                                    </div>

                                    {loadingFile ? (
                                        <div class="rounded-xl border border-dashed border-base-300/80 px-4 py-10 text-center text-sm text-base-content/55">
                                            Chargement du fichier…
                                        </div>
                                    ) : selectedPath ? (
                                        <div class="grid gap-2">
                                            {truncatedRead && (
                                                <p class="text-xs text-warning">
                                                    Fichier tronqué — édition désactivée. Ouvrez-le sur GitHub pour le modifier.
                                                </p>
                                            )}
                                            {lastPullRequestUrl && (
                                                <p class="text-xs text-success">
                                                    Pull Request ouverte :{' '}
                                                    <a class="link link-primary" href={lastPullRequestUrl} rel="noreferrer" target="_blank">
                                                        voir sur GitHub
                                                    </a>
                                                    . Fusionnez-la pour déclencher le déploiement.
                                                </p>
                                            )}
                                            {lastCommitUrl && !lastPullRequestUrl && (
                                                <p class="text-xs text-success">
                                                    Commit poussé sur{' '}
                                                    <a class="link link-primary" href={lastCommitUrl} rel="noreferrer" target="_blank">
                                                        GitHub
                                                    </a>
                                                    {lastDeploymentUuid
                                                        ? ` — déploiement lancé (${lastDeploymentUuid}).`
                                                        : redeployAfterCommit
                                                            ? '.'
                                                            : ' — redeploy non demandé.'}
                                                </p>
                                            )}
                                            {!truncatedRead && (
                                                <>
                                                    <div class="flex flex-wrap gap-2.5 sm:gap-3 md:gap-4 text-xs">
                                                        <label class="inline-flex items-center gap-2">
                                                            <input
                                                                checked={writeMode === 'direct'}
                                                                class="radio radio-primary radio-xs"
                                                                name={`write-mode-${applicationUuid}`}
                                                                type="radio"
                                                                onChange={() => setWriteMode('direct')}
                                                            />
                                                            Commit direct
                                                        </label>
                                                        <label class="inline-flex items-center gap-2">
                                                            <input
                                                                checked={writeMode === 'pull_request'}
                                                                class="radio radio-primary radio-xs"
                                                                name={`write-mode-${applicationUuid}`}
                                                                type="radio"
                                                                onChange={() => setWriteMode('pull_request')}
                                                            />
                                                            Pull Request
                                                        </label>
                                                        {writeMode === 'direct' && (
                                                            <label class="inline-flex items-center gap-2 text-base-content/60">
                                                                <input
                                                                    checked={redeployAfterCommit}
                                                                    class="checkbox checkbox-primary checkbox-xs"
                                                                    type="checkbox"
                                                                    onChange={(event) => setRedeployAfterCommit((event.currentTarget as HTMLInputElement).checked)}
                                                                />
                                                                Redéployer après commit
                                                            </label>
                                                        )}
                                                    </div>
                                                    <label class="grid gap-1">
                                                        <span class="text-xs font-medium text-base-content/55">Message de commit</span>
                                                        <input
                                                            class="input input-bordered input-sm w-full font-mono text-xs"
                                                            type="text"
                                                            value={commitMessage}
                                                            placeholder="fix: corriger le Dockerfile"
                                                            onInput={(event) => setCommitMessage((event.currentTarget as HTMLInputElement).value)}
                                                        />
                                                    </label>
                                                </>
                                            )}
                                            <textarea
                                                class="textarea textarea-bordered min-h-[24rem] w-full font-mono text-xs leading-5"
                                                value={editorValue}
                                                readOnly={truncatedRead}
                                                onInput={(event) => setEditorValue((event.currentTarget as HTMLTextAreaElement).value)}
                                            />
                                            {isDirty && !truncatedRead && (
                                                <p class="text-xs text-base-content/45">Modifications non enregistrées.</p>
                                            )}
                                        </div>
                                    ) : (
                                        <div class="rounded-xl border border-dashed border-base-300/80 px-4 py-10 text-center text-sm text-base-content/55">
                                            Parcourez le dépôt et ouvrez un fichier source.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </DataState>
            </div>
        </Card>
    );
}
