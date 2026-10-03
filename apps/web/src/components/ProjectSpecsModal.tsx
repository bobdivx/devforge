import { useEffect, useState } from 'preact/hooks';
import { FileText } from 'lucide-preact';
import { api, type SpecFeature } from '../lib/api';
import { Badge, Button, HubGrid, HubTile, Input, Modal, Switch, useToast } from './ui';

type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';

function modelName(feature: SpecFeature): string {
  return (feature.provider || '').trim();
}

function copyOf(feature: SpecFeature): { status: string; detail: string; tone: Tone } {
  const who = modelName(feature);
  switch (feature.phase) {
    case 'awaiting_validation':
      return {
        status: 'À approuver',
        detail:
          'Lis la spec, puis appuie sur Approuver pour lancer l’écriture. « oui » et « go » ne suffisent pas.',
        tone: 'warn',
      };
    case 'implement':
      return {
        status: who ? `Écriture · ${who}` : 'Écriture en cours',
        detail: who
          ? `${who} écrit la fonctionnalité. Tu pourras prévisualiser quand ce sera prêt.`
          : 'Un modèle écrit la fonctionnalité. Tu pourras prévisualiser quand ce sera prêt.',
        tone: 'accent',
      };
    case 'converged':
      return {
        status: 'Prête à prévisualiser',
        detail: who
          ? `${who} a terminé. Ouvre la prévisualisation. La publication reste une action à part.`
          : 'La fonctionnalité est prête. Ouvre la prévisualisation. La publication reste une action à part.',
        tone: 'ok',
      };
    case 'rejected':
      return {
        status: 'Refusée',
        detail: 'Spec refusée. Aucun code n’a été écrit.',
        tone: 'neutral',
      };
    case 'failed':
      if (feature.blocker === 'no_provider') {
        return {
          status: 'Pas de modèle capable',
          detail:
            'Aucun modèle configuré ne peut écrire cette fonctionnalité (il faut un modèle qui appelle les outils).',
          tone: 'danger',
        };
      }
      if (feature.blocker === 'no_feature') {
        return {
          status: 'Pas terminé',
          detail:
            'Le modèle a annoncé la fin, mais la fonctionnalité n’a pas été écrite. Réessaie ou retire.',
          tone: 'danger',
        };
      }
      if (feature.blocker === 'empty') {
        return {
          status: 'Pas terminé',
          detail: who
            ? `${who} n’a pas fait le travail. Réessaie ou retire.`
            : 'Le modèle n’a pas fait le travail. Réessaie ou retire.',
          tone: 'danger',
        };
      }
      return {
        status: 'N’a pas abouti',
        detail: 'L’écriture n’a pas réussi. Réessaie ou retire cette spec.',
        tone: 'danger',
      };
    default:
      return {
        status: who ? `Écriture · ${who}` : 'Écriture en cours',
        detail: 'Un modèle écrit la fonctionnalité.',
        tone: 'neutral',
      };
  }
}

function canDismiss(feature: SpecFeature): boolean {
  return (
    !feature.dismissed &&
    ['awaiting_validation', 'implement', 'converged', 'failed', 'rejected'].includes(feature.phase)
  );
}

/** Sur la tuile : un seul Switch pour quitter la liste (pas pendant « à approuver »). */
function showDismissSwitch(feature: SpecFeature): boolean {
  return (
    !feature.dismissed &&
    ['implement', 'converged', 'failed', 'rejected'].includes(feature.phase)
  );
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
            Spec → Approuver → Preview
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

  // Pendant l’écriture, rafraîchir pour afficher le modèle et la fin.
  useEffect(() => {
    if (!open) return;
    const writing = features.some((f) => f.phase === 'implement');
    if (!writing) return;
    const id = window.setInterval(() => {
      void load();
    }, 4000);
    return () => window.clearInterval(id);
  }, [open, projectUuid, features.some((f) => f.phase === 'implement')]);

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
      toast.push({
        title: 'Spec écrite',
        detail: 'Prochaine étape : Approuver (bouton).',
        tone: 'ok',
      });
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
      if (decision === 'reject') {
        setSelected(null);
        toast.push({
          title: 'Spec refusée',
          detail: 'Elle quitte la liste. Aucun code.',
          tone: 'ok',
        });
      } else {
        toast.push({
          title: 'Écriture lancée',
          detail: 'Le modèle choisi apparaît sur la tuile.',
          tone: 'ok',
        });
      }
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
      toast.push({
        title: 'Écriture relancée',
        detail: 'Le modèle reprend. Son nom apparaît sur la tuile.',
        tone: 'ok',
      });
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
      toast.push({ title: 'Spec retirée', detail: 'Elle a quitté la liste.', tone: 'ok' });
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
  const writing = features.filter((f) => f.phase === 'implement').length;
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
            ? `${waiting} à approuver. Bouton Approuver uniquement — pas « oui » ni « go ».`
            : writing > 0
              ? `${writing} en cours d’écriture. Le nom du modèle est sur la tuile.`
              : '1. Écrire la spec · 2. Approuver · 3. Regarder l’écriture · 4. Prévisualiser'
      }
    >
      <div class="space-y-5">
        {error && <p class="text-sm text-[var(--color-danger)]">{error}</p>}
        {current && shown ? (
          <div class="space-y-4">
            <p class="text-sm text-[var(--color-ink)]">{shown.detail}</p>
            {current.phase === 'implement' && modelName(current) ? (
              <p class="text-xs text-[var(--color-ink-muted)]">
                Modèle en cours : <span class="font-medium text-[var(--color-ink)]">{modelName(current)}</span>
              </p>
            ) : null}
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
              {current.phase === 'awaiting_validation' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void decide(current.slug, 'reject')}
                >
                  Refuser
                </Button>
              )}
              {canDismiss(current) && current.phase !== 'awaiting_validation' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void dismiss(current.slug)}
                >
                  Retirer
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
                Écrire la spec
              </Button>
              <p class="text-xs text-[var(--color-ink-muted)]">
                Ensuite : Approuver (bouton), suivre l’écriture avec le nom du modèle, puis
                prévisualiser. Rien n’est publié ici.
              </p>
            </form>

            {features.length === 0 ? (
              <p class="text-sm text-[var(--color-ink-muted)]">Aucune spec pour l’instant.</p>
            ) : (
              <HubGrid cols={3}>
                {features.map((feature, index) => {
                  const copy = copyOf(feature);
                  const removable = showDismissSwitch(feature);
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
                      footer={
                        removable ? (
                          <div
                            class="flex items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <span class="text-[10px] text-[var(--color-ink-muted)]">Dans la liste</span>
                            <Switch
                              checked
                              disabled={busy}
                              label={`Retirer ${feature.title}`}
                              onToggle={() => void dismiss(feature.slug)}
                            />
                          </div>
                        ) : null
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
