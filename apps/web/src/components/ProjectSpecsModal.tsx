import { useEffect, useState } from 'preact/hooks';
import { FileText } from 'lucide-preact';
import { api, type SpecFeature } from '../lib/api';
import { Badge, Button, HubGrid, HubTile, Input, Modal, useToast } from './ui';

type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';

function copyOf(feature: SpecFeature): { status: string; detail: string; tone: Tone } {
  switch (feature.phase) {
    case 'awaiting_validation':
      return {
        status: 'En attente de ton accord',
        detail:
          'Approuve la spec pour lancer l’écriture. « oui » et « go » ne comptent pas.',
        tone: 'warn',
      };
    case 'implement':
      return {
        status: 'En cours',
        detail: 'Le modèle écrit la fonctionnalité.',
        tone: 'accent',
      };
    case 'converged':
      return {
        status: 'Prête à prévisualiser',
        detail: 'La fonctionnalité est prête. Ouvre la prévisualisation.',
        tone: 'ok',
      };
    case 'rejected':
      return {
        status: 'Refusée',
        detail: 'Spec refusée. Aucun code n’a été écrit. Tu peux la retirer.',
        tone: 'neutral',
      };
    case 'failed':
      if (feature.blocker === 'no_provider') {
        return {
          status: 'Pas de modèle capable',
          detail:
            'Ollama ne peut pas écrire cette fonctionnalité : il n’appelle pas les outils. Aucun autre modèle configuré n’est utilisable.',
          tone: 'danger',
        };
      }
      if (feature.blocker === 'no_feature') {
        return {
          status: 'Le modèle n’a pas terminé',
          detail:
            'Le modèle annonce que c’est fini, mais la fonctionnalité n’a pas été écrite.',
          tone: 'danger',
        };
      }
      if (feature.blocker === 'empty') {
        const who = (feature.provider || '').trim();
        return {
          status: 'Le modèle n’a pas terminé',
          detail: who
            ? `${who} n’a pas fait le travail. La fonctionnalité n’a pas été écrite.`
            : 'Le modèle n’a pas fait le travail. La fonctionnalité n’a pas été écrite.',
          tone: 'danger',
        };
      }
      return {
        status: 'N’a pas abouti',
        detail: 'Le modèle n’a pas réussi à terminer. Tu peux réessayer.',
        tone: 'danger',
      };
    default:
      return { status: 'En cours', detail: 'Le modèle écrit la fonctionnalité.', tone: 'neutral' };
  }
}

export function ProjectSpecsTile({
  projectUuid,
  index,
}: {
  projectUuid: string;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <HubTile
        index={index}
        title="Nouvelle fonctionnalité"
        onClick={() => setOpen(true)}
        icon={<FileText size={22} aria-hidden />}
        subtitle={
          <div class="mt-1 text-[11px] font-medium text-[var(--color-ink-muted)]">
            Écrire la spec
          </div>
        }
      />
      <ProjectSpecsModal projectUuid={projectUuid} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function ProjectSpecsModal({
  projectUuid,
  open,
  onClose,
}: {
  projectUuid: string;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [features, setFeatures] = useState<SpecFeature[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api.projectSpecs(projectUuid);
      setFeatures(r.data ?? []);
      setError(null);
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    }
  }

  useEffect(() => {
    if (open) void load();
    else setSelected(null);
  }, [open, projectUuid]);

  const current = features.find((f) => f.slug === selected) ?? null;

  async function createSpec() {
    const t = title.trim();
    const d = description.trim();
    if (!t || !d) {
      setError('Titre et description sont requis.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createProjectSpec(projectUuid, { title: t, description: d });
      setTitle('');
      setDescription('');
      toast.push({ title: 'Spec écrite', detail: 'Approuve-la avant tout code.', tone: 'ok' });
      await load();
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  async function decide(slug: string, decision: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      await api.decideProjectSpec(projectUuid, slug, { decision });
      toast.push({
        title: decision === 'approve' ? 'Spec approuvée' : 'Spec refusée',
        detail: decision === 'approve' ? 'Écriture lancée.' : 'Aucun code.',
        tone: 'ok',
      });
      await load();
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  async function retry(slug: string) {
    setBusy(true);
    setError(null);
    try {
      await api.retryProjectSpec(projectUuid, slug);
      toast.push({ title: 'Écriture relancée', detail: 'Le modèle reprend la fonctionnalité.', tone: 'ok' });
      await load();
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(slug: string) {
    setBusy(true);
    setError(null);
    try {
      await api.dismissProjectSpec(projectUuid, slug);
      setSelected(null);
      toast.push({ title: 'Spec retirée', tone: 'ok' });
      await load();
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  async function openPreview() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.previewStart(projectUuid, false);
      const url = res.data?.preview_url;
      if (url) {
        window.open(url, '_blank', 'noopener');
      } else {
        setError(res.data?.error || res.data?.message || 'La prévisualisation n’a pas démarré.');
      }
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  const waiting = features.filter((f) => f.phase === 'awaiting_validation').length;
  const shown = current ? copyOf(current) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={current ? current.title : 'Nouvelle fonctionnalité'}
      description={
        current
          ? shown?.status
          : waiting > 0
            ? `${waiting} spec en attente. Prochaine étape : approuver. « oui » et « go » ne comptent pas.`
            : 'Prochaine étape : écrire la spec, puis l’approuver. Aucun dépôt n’est créé.'
      }
    >
      <div class="space-y-5">
        {error && <p class="text-sm text-[var(--color-danger)]">{error}</p>}
        {current && shown ? (
          <div class="space-y-4">
            <p class="text-sm text-[var(--color-ink)]">{shown.detail}</p>
            <div class="flex flex-wrap gap-2">
              {current.phase === 'awaiting_validation' && (
                <Button size="sm" disabled={busy} onClick={() => void decide(current.slug, 'approve')}>
                  Approuver
                </Button>
              )}
              {current.phase === 'converged' && (
                <Button size="sm" disabled={busy} onClick={() => void openPreview()}>
                  Ouvrir la prévisualisation
                </Button>
              )}
              {current.phase === 'failed' && (
                <Button size="sm" disabled={busy} onClick={() => void retry(current.slug)}>
                  Réessayer
                </Button>
              )}
              {(current.phase === 'failed' || current.phase === 'rejected') && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void dismiss(current.slug)}
                >
                  Retirer
                </Button>
              )}
              {current.phase === 'awaiting_validation' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void decide(current.slug, 'reject')}
                >
                  Rejeter
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(null)}>
                Retour
              </Button>
            </div>
          </div>
        ) : (
          <>
            <form
              class="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void createSpec();
              }}
            >
              <Input
                label="Fonctionnalité"
                value={title}
                placeholder="Ex. page d'accueil"
                onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
              />
              <label class="flex min-w-0 w-full flex-col gap-1.5 text-sm">
                <span class="font-medium text-[var(--color-ink)]">Description</span>
                <textarea
                  class="min-h-24 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent-soft)]"
                  value={description}
                  placeholder="Ce que la fonctionnalité doit faire, en français."
                  onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
                />
              </label>
              <Button type="submit" disabled={busy}>
                Rédiger la spec
              </Button>
              <p class="text-xs text-[var(--color-ink-muted)]">
                Le Coordinateur s’arrête une fois la spec écrite. « oui » ou « go » ne lancent pas
                le code, et rien n’est publié.
              </p>
            </form>

            {features.length === 0 ? (
              <p class="text-sm text-[var(--color-ink-muted)]">Aucune spec pour l’instant.</p>
            ) : (
              <HubGrid cols={3}>
                {features.map((feature, index) => {
                  const copy = copyOf(feature);
                  return (
                    <HubTile
                      key={feature.slug}
                      index={index}
                      layout="auto"
                      title={feature.title}
                      icon={<FileText size={22} aria-hidden />}
                      onClick={() => {
                        setError(null);
                        setSelected(feature.slug);
                      }}
                      subtitle={
                        <div class="mt-1">
                          <Badge tone={copy.tone}>{copy.status}</Badge>
                        </div>
                      }
                    />
                  );
                })}
              </HubGrid>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
