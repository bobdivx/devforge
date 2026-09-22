import { useEffect, useState } from 'preact/hooks';
import { ExternalLink, Maximize2, RefreshCw } from 'lucide-preact';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button, Spinner } from '../ui';
import type { PreviewServerStatus } from './WorkspaceTopBar';

type Tab = 'preview' | 'files';

type Props = {
  projectUuid: string;
  tab: Tab;
  onTab: (tab: Tab) => void;
  previewUrl: string | null;
  previewStatus: PreviewServerStatus;
  onExpandPreview: () => void;
};

export function WorkspaceAtelier({
  projectUuid,
  tab,
  onTab,
  previewUrl,
  previewStatus,
  onExpandPreview,
}: Props) {
  const [nonce, setNonce] = useState(0);

  return (
    <div class="flex h-full min-h-0 flex-col bg-[var(--color-card)]">
      <div class="flex shrink-0 items-center gap-1 border-b border-[var(--color-line)] px-2 py-1.5">
        <TabButton active={tab === 'preview'} onClick={() => onTab('preview')}>
          Preview
        </TabButton>
        <TabButton active={tab === 'files'} onClick={() => onTab('files')}>
          Fichiers
        </TabButton>
      </div>
      <div class="relative min-h-0 flex-1">
        <div class={cn('absolute inset-0', tab !== 'preview' && 'hidden')}>
          <PreviewPane
            previewUrl={previewUrl}
            previewStatus={previewStatus}
            nonce={nonce}
            onRefresh={() => setNonce((n) => n + 1)}
            onExpand={onExpandPreview}
          />
        </div>
        <div class={cn('absolute inset-0', tab !== 'files' && 'hidden')}>
          <WorkspaceFiles projectUuid={projectUuid} onSaved={() => setNonce((n) => n + 1)} />
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        'rounded-md px-2.5 py-1 text-xs font-medium transition',
        active
          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]',
      )}
    >
      {children}
    </button>
  );
}

function PreviewPane({
  previewUrl,
  previewStatus,
  nonce,
  onRefresh,
  onExpand,
}: {
  previewUrl: string | null;
  previewStatus: PreviewServerStatus;
  nonce: number;
  onRefresh: () => void;
  onExpand: () => void;
}) {
  if (previewStatus !== 'running' || !previewUrl) {
    return (
      <div class="flex h-full items-center justify-center px-6 text-center">
        <p class="text-sm text-[var(--color-ink-muted)]">
          {previewStatus === 'starting'
            ? 'Le serveur de dev démarre.'
            : 'Démarre le serveur de dev pour voir l’application ici.'}
        </p>
      </div>
    );
  }

  const targetUrl = `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}_df=${nonce}`;

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-line)] px-2 py-1">
        <p class="min-w-0 truncate text-[11px] text-[var(--color-ink-faint)]">
          {previewUrl.replace(/^https?:\/\//, '')}
        </p>
        <div class="flex shrink-0 items-center">
          <Button size="sm" variant="ghost" onClick={onRefresh} aria-label="Rafraîchir la preview">
            <RefreshCw size={14} strokeWidth={2} aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" onClick={onExpand} aria-label="Plein écran">
            <Maximize2 size={14} strokeWidth={2} aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" href={previewUrl} target="_blank" aria-label="Ouvrir dans un nouvel onglet">
            <ExternalLink size={14} strokeWidth={2} aria-hidden />
          </Button>
        </div>
      </div>
      <iframe
        key={nonce}
        src={targetUrl}
        class="min-h-0 w-full flex-1 border-0 bg-white"
        title="Preview atelier"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
      />
    </div>
  );
}

function WorkspaceFiles({
  projectUuid,
  onSaved,
}: {
  projectUuid: string;
  onSaved: () => void;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [truncatedFile, setTruncatedFile] = useState(false);
  const dirty = path !== null && content !== saved && !truncatedFile;

  async function loadList() {
    try {
      const r = await api.executeAgentTool('list_project_files', { project_uuid: projectUuid });
      const data = r.data ?? {};
      if (data.ok === false) {
        setListError(typeof data.error === 'string' ? data.error : 'Liste impossible');
        setFiles([]);
        return;
      }
      const list = Array.isArray(data.files) ? data.files.filter((f): f is string => typeof f === 'string') : [];
      setFiles(list);
      setTruncated(data.truncated === true);
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Liste impossible');
    } finally {
      setLoading(false);
    }
  }

  async function openFile(next: string, force = false) {
    if (!force && dirty && next !== path) {
      const ok = window.confirm('Des modifications ne sont pas enregistrées. Ouvrir un autre fichier ?');
      if (!ok) return;
    }
    if (next.includes('..') || next.startsWith('/')) {
      setFileError('Chemin refusé.');
      return;
    }
    setFileError(null);
    setNotice(null);
    setTruncatedFile(false);
    setPath(next);
    try {
      const r = await api.executeAgentTool('read_project_file', {
        project_uuid: projectUuid,
        path: next,
      });
      const data = r.data ?? {};
      if (data.ok === false) {
        setContent('');
        setSaved('');
        setFileError(typeof data.error === 'string' ? data.error : 'Lecture impossible');
        return;
      }
      const text = typeof data.content === 'string' ? data.content : '';
      const cut = data.truncated === true;
      setContent(text);
      setSaved(text);
      setTruncatedFile(cut);
      if (cut) setNotice('Fichier trop long pour être édité ici.');
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Lecture impossible');
    }
  }

  async function save() {
    if (!path || saving) return;
    if (path.includes('..') || path.startsWith('/')) {
      setFileError('Chemin refusé.');
      return;
    }
    setSaving(true);
    setFileError(null);
    setNotice(null);
    try {
      const r = await api.executeAgentTool('write_project_file', {
        project_uuid: projectUuid,
        path,
        content,
        mode: 'local',
      });
      const data = r.data ?? {};
      if (data.ok === false) {
        setFileError(typeof data.error === 'string' ? data.error : 'Enregistrement impossible');
        return;
      }
      setSaved(content);
      setNotice('Enregistré dans le workdir.');
      onSaved();
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadList();
  }, [projectUuid]);

  useEffect(() => {
    function onRefresh() {
      void loadList();
      if (path && content === saved) void openFile(path, true);
    }
    window.addEventListener('devforge:preview-refresh', onRefresh);
    return () => window.removeEventListener('devforge:preview-refresh', onRefresh);
  }, [projectUuid, path, content, saved]);

  const dirOf = (file: string) => {
    const i = file.lastIndexOf('/');
    return i === -1 ? '' : file.slice(0, i + 1);
  };
  const nameOf = (file: string) => {
    const i = file.lastIndexOf('/');
    return i === -1 ? file : file.slice(i + 1);
  };

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="max-h-[38%] min-h-24 shrink-0 overflow-y-auto border-b border-[var(--color-line)]">
        {loading && (
          <p class="flex items-center gap-2 px-3 py-3 text-xs text-[var(--color-ink-muted)]">
            <Spinner /> Fichiers…
          </p>
        )}
        {listError && <p class="px-3 py-3 text-xs text-[var(--color-danger)]">{listError}</p>}
        {!loading && !listError && files.length === 0 && (
          <p class="px-3 py-3 text-xs text-[var(--color-ink-muted)]">Aucun fichier dans le workdir.</p>
        )}
        <ul>
          {files.map((file) => (
            <li key={file}>
              <button
                type="button"
                onClick={() => void openFile(file)}
                class={cn(
                  'flex w-full min-w-0 items-baseline gap-0 px-3 py-1 text-left font-mono text-[11px] hover:bg-white/5',
                  path === file ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-ink)]',
                )}
              >
                <span class="truncate text-[var(--color-ink-faint)]">{dirOf(file)}</span>
                <span class="shrink-0">{nameOf(file)}</span>
              </button>
            </li>
          ))}
        </ul>
        {truncated && (
          <p class="px-3 py-2 text-[11px] text-[var(--color-ink-faint)]">Liste limitée aux 200 premiers fichiers.</p>
        )}
      </div>

      {path ? (
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
            <p class="min-w-0 truncate font-mono text-[11px] text-[var(--color-ink-muted)]">
              {path}
              {dirty ? ' · modifié' : ''}
            </p>
            <Button size="sm" type="button" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? '…' : 'Enregistrer'}
            </Button>
          </div>
          {fileError && <p class="px-3 text-xs text-[var(--color-danger)]">{fileError}</p>}
          {notice && <p class="px-3 text-xs text-[var(--color-ink-muted)]">{notice}</p>}
          <textarea
            class="min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-2 font-mono text-xs text-[var(--color-ink)] outline-none"
            value={content}
            readOnly={truncatedFile}
            spellcheck={false}
            onInput={(ev) => setContent((ev.target as HTMLTextAreaElement).value)}
          />
        </div>
      ) : (
        <p class="px-3 py-4 text-xs text-[var(--color-ink-muted)]">Choisis un fichier pour le modifier.</p>
      )}
    </div>
  );
}
