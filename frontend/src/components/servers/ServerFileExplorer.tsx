import {
    ChevronRight,
    FileText,
    Folder,
    FolderOpen,
    Link2,
    RefreshCw,
    Save,
    Search,
} from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
    domainApi,
    type ServerFilesystemEntry,
    type ServerFilesystemListing,
} from '../../lib/domain-api';
import { DataState } from '../ui/DataState';
import { Card } from '../ui/Card';

type Props = {
    serverUuid: string;
    initialPath?: string;
    terminalEnabled?: boolean;
    canEdit?: boolean;
};

function entryIcon(entry: ServerFilesystemEntry) {
    if (entry.type === 'directory') {
        return Folder;
    }

    if (entry.type === 'symlink') {
        return Link2;
    }

    return FileText;
}

function resolveSearchResultPath(result: string, mode: 'name' | 'content', root: string): string {
    if (mode === 'name') {
        return result.startsWith('/') ? result : `${root}/${result}`.replace(/\/+/g, '/');
    }

    const match = result.match(/^(.+?):(\d+):/);
    if (!match) {
        return result;
    }

    const relative = match[1].replace(/^\.\//, '');

    return relative.startsWith('/') ? relative : `${root}/${relative}`.replace(/\/+/g, '/');
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
    if (path === '/') {
        return ['/'];
    }

    const parts = path.split('/').filter(Boolean);
    const segments: string[] = [];

    for (let index = 0; index < parts.length; index += 1) {
        segments.push(`/${parts.slice(0, index + 1).join('/')}`);
    }

    return segments;
}

export function ServerFileExplorer({
    serverUuid,
    initialPath = '/media/Docker/AppData/devforge',
    terminalEnabled = true,
    canEdit = true,
}: Props) {
    const [listing, setListing] = useState<ServerFilesystemListing | null>(null);
    const [currentPath, setCurrentPath] = useState(initialPath);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [editorValue, setEditorValue] = useState('');
    const [savedValue, setSavedValue] = useState('');
    const [loadingListing, setLoadingListing] = useState(true);
    const [loadingFile, setLoadingFile] = useState(false);
    const [saving, setSaving] = useState(false);
    const [searchPattern, setSearchPattern] = useState('');
    const [searchMode, setSearchMode] = useState<'name' | 'content'>('name');
    const [searchResults, setSearchResults] = useState<string[]>([]);
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [truncatedRead, setTruncatedRead] = useState(false);

    const isDirty = selectedPath !== null && editorValue !== savedValue;
    const breadcrumbs = useMemo(() => breadcrumbSegments(currentPath), [currentPath]);

    const loadDirectory = async (path: string) => {
        setLoadingListing(true);
        setError(null);
        setFeedback(null);

        try {
            const response = await domainApi.listServerDirectory(serverUuid, path);
            setListing(response.data);
            setCurrentPath(response.data.path);
            setSearchResults([]);
        } catch (loadError: unknown) {
            setError(loadError);
        } finally {
            setLoadingListing(false);
        }
    };

    const openFile = async (path: string) => {
        setLoadingFile(true);
        setError(null);
        setFeedback(null);

        try {
            const response = await domainApi.readServerFile(serverUuid, path);
            setSelectedPath(response.data.path);
            setEditorValue(response.data.content);
            setSavedValue(response.data.content);
            setTruncatedRead(response.data.truncated);
        } catch (loadError: unknown) {
            setSelectedPath(null);
            setError(loadError);
        } finally {
            setLoadingFile(false);
        }
    };

    const openEntry = async (entry: ServerFilesystemEntry) => {
        const nextPath = currentPath === '/'
            ? `/${entry.name}`
            : `${currentPath}/${entry.name}`;

        if (entry.type === 'directory') {
            setSelectedPath(null);
            setEditorValue('');
            setSavedValue('');
            await loadDirectory(nextPath);
            return;
        }

        await openFile(nextPath);
    };

    const saveFile = async () => {
        if (!selectedPath || !canEdit) {
            return;
        }

        setSaving(true);
        setError(null);
        setFeedback(null);

        try {
            const response = await domainApi.writeServerFile(serverUuid, selectedPath, editorValue);
            setSavedValue(editorValue);
            setFeedback(response.data.message);
        } catch (saveError: unknown) {
            setError(saveError);
        } finally {
            setSaving(false);
        }
    };

    const runSearch = async () => {
        const pattern = searchPattern.trim();
        if (!pattern) {
            return;
        }

        setSearching(true);
        setError(null);
        setFeedback(null);

        try {
            const response = await domainApi.searchServerFiles(serverUuid, {
                pattern,
                mode: searchMode,
                path: currentPath,
            });
            setSearchResults(response.data.results);
        } catch (searchError: unknown) {
            setSearchResults([]);
            setError(searchError);
        } finally {
            setSearching(false);
        }
    };

    useEffect(() => {
        setCurrentPath(initialPath);
        void loadDirectory(initialPath);
    }, [serverUuid, initialPath]);

    if (!terminalEnabled) {
        return (
            <Card title="Fichiers distants">
                <p class="text-sm text-base-content/65">
                    Le terminal SSH est désactivé sur ce serveur. Activez-le pour parcourir et éditer les fichiers distants.
                </p>
            </Card>
        );
    }

    return (
        <Card title="Explorateur de fichiers">
            <div class="grid gap-2.5 sm:gap-3 md:gap-4">
                <div class="flex flex-wrap items-center gap-2 text-xs text-base-content/55">
                    {breadcrumbs.map((segment, index) => (
                        <span key={segment} class="inline-flex items-center gap-2">
                            {index > 0 && <ChevronRight class="size-3" aria-hidden />}
                            <button
                                class={`font-mono hover:text-primary ${segment === currentPath ? 'text-base-content font-medium' : ''}`}
                                type="button"
                                onClick={() => void loadDirectory(segment)}
                            >
                                {segment}
                            </button>
                        </span>
                    ))}
                </div>

                <div class="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div class="join w-full">
                        <input
                            class="input input-bordered input-sm join-item w-full font-mono"
                            type="search"
                            placeholder={searchMode === 'name' ? 'Rechercher un nom (*.env, docker-compose.yml…)' : 'Rechercher dans le contenu'}
                            value={searchPattern}
                            onInput={(event) => setSearchPattern((event.target as HTMLInputElement).value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    void runSearch();
                                }
                            }}
                        />
                        <select
                            class="select select-bordered select-sm join-item"
                            value={searchMode}
                            onChange={(event) => setSearchMode((event.target as HTMLSelectElement).value as 'name' | 'content')}
                        >
                            <option value="name">Nom</option>
                            <option value="content">Contenu</option>
                        </select>
                        <button class="btn btn-primary btn-sm join-item" type="button" onClick={() => void runSearch()} disabled={searching}>
                            <Search class="size-3.5" aria-hidden />
                            Chercher
                        </button>
                    </div>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void loadDirectory(currentPath)} disabled={loadingListing}>
                        <RefreshCw class={`size-3.5 ${loadingListing ? 'animate-spin' : ''}`} aria-hidden />
                        Actualiser
                    </button>
                </div>

                {feedback && (
                    <div class="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                        {feedback}
                    </div>
                )}

                <DataState loading={loadingListing} error={error} onRetry={() => void loadDirectory(currentPath)}>
                    <div class="grid gap-2.5 sm:gap-3 md:gap-2.5 sm:gap-3 md:gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
                        <div class="grid gap-3">
                            <div class="rounded-xl border border-base-300/70 bg-base-100/50">
                                <div class="border-b border-base-300/60 px-3 py-2 text-xs font-medium uppercase tracking-wide text-base-content/45">
                                    {listing?.entry_count ?? 0} élément(s)
                                </div>
                                <ul class="max-h-[28rem] overflow-y-auto p-2">
                                    {listing?.parent_path && (
                                        <li>
                                            <button
                                                class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-base-200/70"
                                                type="button"
                                                onClick={() => void loadDirectory(listing.parent_path!)}
                                            >
                                                <FolderOpen class="size-3.5 sm:size-4 shrink-0 text-warning" aria-hidden />
                                                ..
                                            </button>
                                        </li>
                                    )}
                                    {(listing?.entries ?? []).map((entry) => {
                                        const Icon = entryIcon(entry);
                                        const entryPath = currentPath === '/'
                                            ? `/${entry.name}`
                                            : `${currentPath}/${entry.name}`;

                                        return (
                                            <li key={entryPath}>
                                                <button
                                                    class={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-base-200/70 ${
                                                        selectedPath === entryPath ? 'bg-primary/10 text-primary' : ''
                                                    }`}
                                                    type="button"
                                                    onClick={() => void openEntry(entry)}
                                                >
                                                    <Icon class="mt-0.5 size-3.5 sm:size-4 shrink-0" aria-hidden />
                                                    <span class="min-w-0 flex-1">
                                                        <span class="block truncate font-medium">{entry.name}</span>
                                                        <span class="block text-[11px] text-base-content/45">
                                                            {entry.type === 'directory' ? 'dossier' : formatBytes(entry.size)}
                                                            {entry.symlink_target ? ` → ${entry.symlink_target}` : ''}
                                                        </span>
                                                    </span>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>

                            {searchResults.length > 0 && (
                                <div class="rounded-xl border border-base-300/70 bg-base-100/50">
                                    <div class="border-b border-base-300/60 px-3 py-2 text-xs font-medium uppercase tracking-wide text-base-content/45">
                                        Résultats ({searchResults.length})
                                    </div>
                                    <ul class="max-h-48 overflow-y-auto p-2">
                                        {searchResults.map((result) => (
                                            <li key={result}>
                                                <button
                                                    class="w-full rounded-lg px-2 py-1.5 text-left font-mono text-[11px] hover:bg-base-200/70"
                                                    type="button"
                                                    onClick={() => void openFile(resolveSearchResultPath(result, searchMode, currentPath))}
                                                >
                                                    {result}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        <div class="grid gap-2">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <p class="text-xs sm:text-sm font-semibold">
                                        {selectedPath ? 'Éditeur' : 'Sélectionnez un fichier'}
                                    </p>
                                    {selectedPath && (
                                        <p class="font-mono text-[11px] text-base-content/45">{selectedPath}</p>
                                    )}
                                </div>
                                {selectedPath && canEdit && (
                                    <button
                                        class="btn btn-primary btn-sm"
                                        type="button"
                                        onClick={() => void saveFile()}
                                        disabled={!isDirty || saving || loadingFile}
                                    >
                                        <Save class="size-3.5" aria-hidden />
                                        {saving ? 'Enregistrement…' : 'Enregistrer'}
                                    </button>
                                )}
                            </div>

                            {loadingFile ? (
                                <div class="rounded-xl border border-dashed border-base-300/80 px-3 sm:px-4 py-10 text-center text-sm text-base-content/55">
                                    Chargement du fichier…
                                </div>
                            ) : selectedPath ? (
                                <div class="grid gap-2">
                                    {truncatedRead && (
                                        <p class="text-xs text-warning">
                                            Fichier tronqué — seule une partie du contenu est affichée.
                                        </p>
                                    )}
                                    <textarea
                                        class="textarea textarea-bordered min-h-[24rem] w-full font-mono text-xs leading-5"
                                        value={editorValue}
                                        readOnly={!canEdit}
                                        onInput={(event) => setEditorValue((event.target as HTMLTextAreaElement).value)}
                                    />
                                </div>
                            ) : (
                                <div class="rounded-xl border border-dashed border-base-300/80 px-3 sm:px-4 py-10 text-center text-sm text-base-content/55">
                                    Ouvrez un fichier dans la liste pour afficher son contenu.
                                </div>
                            )}
                        </div>
                    </div>
                </DataState>
            </div>
        </Card>
    );
}
