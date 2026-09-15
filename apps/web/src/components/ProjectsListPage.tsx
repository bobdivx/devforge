import { useEffect, useState } from 'preact/hooks';
import { api, type Project } from '../lib/api';
import { projectStatusMeta, projectSyncMeta } from '../lib/status';
import { AppShell } from './AppShell';
import { NewGithubAppWizard } from './NewGithubAppWizard';
import { Alert, Badge, Button, Input, Modal, Table, Td, Tr, useToast } from './ui';

type Mode = 'github' | 'empty';

function formatUpdatedAt(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function ProjectsListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('github');
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function load() {
    try {
      const r = await api.projects();
      setProjects(r.data);
      setError(null);
    } catch (e: unknown) {
      // Soft-fail: ne pas écraser les projets existants en cas d'erreur pendant le polling
      if (projects.length === 0) {
        setError(String((e as Error).message || e));
      }
    } finally {
      if (loading) {
        setLoading(false);
      }
    }
  }

  // Chargement initial
  useEffect(() => {
    load();
  }, []);

  // Polling automatique avec gestion de la visibilité
  useEffect(() => {
    // Même logique de polling adaptative que HomePage
    const shouldPollFast = projects.some(
      (p) =>
        ['deploying', 'building', 'queued'].includes(p.status) ||
        ['behind', 'deploying', 'error'].includes(p.sync?.state || ''),
    );
    const interval = shouldPollFast ? 7000 : 17000;

    if (loading) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let isVisible = !document.hidden;

    const handleVisibilityChange = () => {
      const wasVisible = isVisible;
      isVisible = !document.hidden;

      if (!wasVisible && isVisible) {
        load();
        startPolling();
      } else if (wasVisible && !isVisible) {
        stopPolling();
      }
    };

    const startPolling = () => {
      stopPolling();
      if (isVisible) {
        timer = setInterval(() => {
          load();
        }, interval);
      }
    };

    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    if (isVisible) {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loading, projects]);

  function openModal(next: Mode = 'github') {
    setMode(next);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setName('');
  }

  async function createEmpty(e: Event) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-');
      await api.createProject({
        name: name.trim(),
        server_id: 'default',
        workdir: `/data/devforge/applications/${slug}`,
        test_command: 'npm test --if-present',
        build_pack: 'nixpacks',
        port: 3000,
      });
      setName('');
      toast.push({ title: 'Projet créé', tone: 'ok' });
      closeModal();
      await load();
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell active="projects" title="Projects">
      {error && (
        <Alert tone="warn" class="mb-4">
          {error}
        </Alert>
      )}

      <button
        type="button"
        onClick={() => openModal('github')}
        class="mb-8 w-full rounded-2xl border border-dashed border-[var(--color-line-strong)] bg-[var(--color-card)]/60 px-5 py-8 text-left transition hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]/40"
      >
        <div class="text-sm font-medium text-[var(--color-ink)]">Nouveau projet</div>
        <p class="mt-1 text-sm text-[var(--color-ink-muted)]">
          Importer depuis GitHub ou créer un projet vide
        </p>
      </button>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title="Nouveau projet"
        description="Choisis la source, puis configure l’app."
        size="xl"
      >
        <div class="mb-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={mode === 'github' ? 'secondary' : 'outline'}
            onClick={() => setMode('github')}
          >
            Depuis GitHub
          </Button>
          <Button
            size="sm"
            variant={mode === 'empty' ? 'secondary' : 'outline'}
            onClick={() => setMode('empty')}
          >
            Projet vide
          </Button>
        </div>

        {mode === 'github' ? (
          <NewGithubAppWizard bare />
        ) : (
          <form class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end" onSubmit={createEmpty}>
            <div class="min-w-0 w-full flex-1">
              <Input
                placeholder="Nom du projet…"
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
              />
            </div>
            <Button type="submit" variant="outline" disabled={busy} class="w-full sm:w-auto">
              Créer
            </Button>
          </form>
        )}
      </Modal>

      <Table headers={['Nom', 'Status', 'Dernière update', 'Sync GitHub']}>
        {projects.map((p) => {
          const st = projectStatusMeta(p.status);
          const sync = projectSyncMeta(p.sync);
          return (
          <Tr key={p.uuid}>
            <Td>
              <a
                class="font-medium text-[var(--color-accent)]"
                href={`/app/projects/view?uuid=${encodeURIComponent(p.uuid)}`}
              >
                {p.name}
              </a>
              {p.git_branch ? (
                <div class="mt-0.5 text-xs text-[var(--color-ink-muted)]">{p.git_branch}</div>
              ) : null}
            </Td>
            <Td>
              <Badge tone={st.tone}>{st.label}</Badge>
            </Td>
            <Td class="text-[var(--color-ink-muted)] tabular-nums">
              {formatUpdatedAt(p.updated_at)}
            </Td>
            <Td>
              <a
                href={`/app/projects/view?uuid=${encodeURIComponent(p.uuid)}&tab=git`}
                class="inline-flex"
                title={sync.title}
              >
                <Badge tone={sync.tone}>{sync.label}</Badge>
              </a>
            </Td>
          </Tr>
          );
        })}
      </Table>
    </AppShell>
  );
}
