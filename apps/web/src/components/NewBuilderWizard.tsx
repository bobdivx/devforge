import { useEffect, useState } from 'preact/hooks';
import { api, type ClusterNode, type ProjectTemplate } from '../lib/api';
import { Alert, Button, FadeIn, Input, useToast } from './ui';
import { NodeSelect } from './NodeSelect';

/**
 * Builder wizard — création d'app depuis un prompt naturel.
 * Slice 1 : crée un projet vide + seed un agent avec le prompt utilisateur.
 */
export function NewBuilderWizard({
  bare = false,
  onClose,
}: {
  bare?: boolean;
  onClose?: () => void;
} = {}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState('astro-preact-sqlite');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [nodes, setNodes] = useState<ClusterNode[]>([]);
  const [serverId, setServerId] = useState('default');

  useEffect(() => {
    api
      .clusterNodes()
      .then((r) => {
        setNodes(r.nodes ?? []);
      })
      .catch(() => {});
  }, []);

  async function loadTemplates() {
    if (templatesLoaded) return;
    try {
      const res = await api.templates();
      setTemplates(res.data);
      if (res.data.length > 0 && !template) {
        setTemplate(res.data[0].id);
      }
    } catch (err) {
      console.error('Erreur de chargement des templates:', err);
    } finally {
      setTemplatesLoaded(true);
    }
  }

  async function submit(e: Event) {
    e.preventDefault();
    const cleanTitle = title.trim();
    const cleanPrompt = prompt.trim();

    if (!cleanTitle) {
      setError('Le titre est requis.');
      return;
    }
    if (!cleanPrompt) {
      setError('Décris ce que tu veux construire.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await api.scaffoldProject({
        title: cleanTitle,
        prompt: cleanPrompt,
        template,
        server_id: serverId || 'default',
      });

      toast.push({
        title: 'Projet créé',
        detail: `${cleanTitle} — l'agent va démarrer`,
        tone: 'ok',
      });

      // Redirect to workspace tab in builder mode
      const agentUuid = res.data.agent?.uuid || '';
      window.location.href = `/app/projects/view?uuid=${encodeURIComponent(res.data.project.uuid)}&tab=workspace&builder=1${agentUuid ? `&agent=${encodeURIComponent(agentUuid)}` : ''}`;
    } catch (err: unknown) {
      const msg = String((err as Error).message || err);
      setError(msg);
      setBusy(false);
    }
  }

  if (!templatesLoaded) {
    loadTemplates();
  }

  const body = (
    <form class="space-y-4" onSubmit={submit}>
      {error && (
        <Alert tone="danger" class="mb-3">
          {error}
        </Alert>
      )}

      <Input
        label="Nom de l'application"
        placeholder="ex. Mon blog Next.js"
        value={title}
        onInput={(ev) => setTitle((ev.target as HTMLInputElement).value)}
        disabled={busy}
        hint="Court et descriptif"
        required
      />

      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium">Qu'est-ce que tu veux construire ?</span>
        <textarea
          class="min-h-[160px] w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm"
          placeholder="Décris ton app en français : stack, features, contraintes…"
          value={prompt}
          onInput={(ev) => setPrompt((ev.target as HTMLTextAreaElement).value)}
          disabled={busy}
          required
        />
        <span class="text-xs text-[var(--color-ink-faint)]">
          L'agent DevForge va scaffolder le projet et configurer le build.
        </span>
      </label>

      {templates.length > 0 && (
        <label class="flex flex-col gap-1.5 text-sm">
          <span class="font-medium">Template de base</span>
          <select
            class="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm"
            value={template}
            onChange={(ev) => setTemplate((ev.target as HTMLSelectElement).value)}
            disabled={busy}
          >
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
          {template && templates.find((t) => t.id === template) && (
            <span class="text-xs text-[var(--color-ink-faint)]">
              {templates.find((t) => t.id === template)!.description}
            </span>
          )}
        </label>
      )}

      <NodeSelect
        nodes={nodes}
        value={serverId}
        onChange={setServerId}
        disabled={busy}
        hint="La forge tourne uniquement sur ce nœud."
      />

      <div class="flex flex-wrap justify-between gap-2">
        {onClose && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Annuler
          </Button>
        )}
        <Button type="submit" variant="secondary" size="sm" disabled={busy} class="ml-auto">
          {busy ? 'Création en cours…' : 'Créer avec un agent'}
        </Button>
      </div>
    </form>
  );

  return (
    <FadeIn>
      {bare ? (
        body
      ) : (
        <div class="rounded-2xl bg-[var(--color-card)] p-6 shadow-2xl">
          <h2 class="mb-1 text-xl font-semibold">Nouvelle app avec l'agent</h2>
          <p class="mb-4 text-sm text-[var(--color-ink-muted)]">
            Décris ce que tu veux, DevForge scaffold le projet.
          </p>
          {body}
        </div>
      )}
    </FadeIn>
  );
}
