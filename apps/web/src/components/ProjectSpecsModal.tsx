import { useEffect, useMemo, useState } from 'preact/hooks';
import { Check, FileText, Loader2, Pencil, Sparkles } from 'lucide-preact';
import { api, type SpecFeature } from '../lib/api';
import { cn } from '../lib/cn';
import { Badge, Button, HubTile, Input, Modal, Switch, useToast } from './ui';

type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';
type JourneyStep = 'intent' | 'spec' | 'write' | 'preview';

const STEPS: { id: JourneyStep; label: string; hint: string }[] = [
  { id: 'intent', label: 'Intention', hint: 'Ce que tu veux' },
  { id: 'spec', label: 'Spec', hint: 'Lire puis Approuver' },
  { id: 'write', label: 'Écriture', hint: 'Le modèle travaille' },
  { id: 'preview', label: 'Preview', hint: 'Vérifier en local' },
];

function modelName(feature: SpecFeature): string {
  return (feature.provider || '').trim();
}

function phaseToStep(phase: string): JourneyStep {
  switch (phase) {
    case 'awaiting_validation':
      return 'spec';
    case 'implement':
    case 'failed':
      return 'write';
    case 'converged':
      return 'preview';
    default:
      return 'intent';
  }
}

function stepIndex(step: JourneyStep): number {
  return STEPS.findIndex((s) => s.id === step);
}

function statusBadge(feature: SpecFeature): { label: string; tone: Tone } {
  const who = modelName(feature);
  switch (feature.phase) {
    case 'awaiting_validation':
      return { label: 'À approuver', tone: 'warn' };
    case 'implement':
      return { label: who ? `Écriture · ${who}` : 'Écriture…', tone: 'accent' };
    case 'converged':
      return { label: 'Preview prête', tone: 'ok' };
    case 'failed':
      if (feature.blocker === 'no_provider') return { label: 'Pas de modèle', tone: 'danger' };
      return { label: 'À reprendre', tone: 'danger' };
    default:
      return { label: feature.phase, tone: 'neutral' };
  }
}

function canDismiss(feature: SpecFeature): boolean {
  return (
    !feature.dismissed &&
    ['awaiting_validation', 'implement', 'converged', 'failed', 'rejected'].includes(feature.phase)
  );
}

function showDismissSwitch(feature: SpecFeature): boolean {
  return (
    !feature.dismissed &&
    ['implement', 'converged', 'failed', 'rejected'].includes(feature.phase)
  );
}

function writeDetail(feature: SpecFeature): string {
  const who = modelName(feature);
  if (feature.phase === 'implement') {
    return who
      ? `${who} écrit la fonctionnalité. Tu pourras prévisualiser quand ce sera prêt.`
      : 'Un modèle écrit la fonctionnalité. Tu pourras prévisualiser quand ce sera prêt.';
  }
  if (feature.blocker === 'no_provider') {
    return 'Aucun modèle configuré ne peut écrire cette fonctionnalité (il faut un modèle qui appelle les outils).';
  }
  if (feature.blocker === 'no_feature') {
    return 'Le modèle a annoncé la fin, mais la fonctionnalité n’a pas été écrite. Réessaie ou retire.';
  }
  if (feature.blocker === 'empty') {
    return who
      ? `${who} n’a pas fait le travail. Réessaie ou retire.`
      : 'Le modèle n’a pas fait le travail. Réessaie ou retire.';
  }
  return feature.note?.trim() || 'L’écriture n’a pas réussi. Réessaie ou retire cette spec.';
}

function SpecStepper({
  current,
  reached,
}: {
  current: JourneyStep;
  /** Highest step the feature has reached (for completed checkmarks). */
  reached: JourneyStep;
}) {
  const cur = stepIndex(current);
  const max = stepIndex(reached);
  return (
    <ol class="mb-5 grid grid-cols-4 gap-1.5 sm:gap-2" aria-label="Parcours de la fonctionnalité">
      {STEPS.map((step, i) => {
        const active = i === cur;
        const done = i < cur || (i <= max && i < cur);
        const reachedHere = i <= Math.max(cur, max);
        return (
          <li
            key={step.id}
            class={cn(
              'relative flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-center ring-1 transition',
              active
                ? 'bg-[var(--color-accent-soft)] ring-[var(--color-accent)]/50'
                : reachedHere
                  ? 'bg-white/[0.03] ring-white/10'
                  : 'bg-transparent ring-transparent opacity-55',
            )}
            aria-current={active ? 'step' : undefined}
          >
            <span
              class={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                active
                  ? 'bg-[var(--color-accent)] text-black'
                  : done || (reachedHere && i < cur)
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-white/10 text-[var(--color-ink-muted)]',
              )}
            >
              {done || (i < cur) ? <Check size={14} strokeWidth={2.5} aria-hidden /> : i + 1}
            </span>
            <span
              class={cn(
                'text-[11px] font-medium sm:text-xs',
                active ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-muted)]',
              )}
            >
              {step.label}
            </span>
            <span class="hidden text-[10px] leading-tight text-[var(--color-ink-faint)] sm:block">
              {step.hint}
            </span>
          </li>
        );
      })}
    </ol>
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
            Intention → Spec → Preview
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
  const [specMd, setSpecMd] = useState('');
  const [step, setStep] = useState<JourneyStep>('intent');
  /** When adjusting an awaiting spec, revise instead of create. */
  const [revisingSlug, setRevisingSlug] = useState<string | null>(null);

  const current = useMemo(
    () => features.find((f) => f.slug === selected) ?? null,
    [features, selected],
  );

  const reached: JourneyStep = current ? phaseToStep(current.phase) : 'intent';

  async function load() {
    try {
      const r = await api.projectSpecs(projectUuid);
      setFeatures(r.data ?? []);
      setError(null);
      return r.data ?? [];
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
      return [] as SpecFeature[];
    }
  }

  async function loadSpecBody(slug: string) {
    try {
      const r = await api.getProjectSpec(projectUuid, slug);
      setSpecMd(r.spec_md || '');
      if (r.data) {
        setFeatures((prev) => {
          const others = prev.filter((f) => f.slug !== slug);
          return [...others, r.data].sort((a, b) => a.slug.localeCompare(b.slug));
        });
      }
      return r;
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
      return null;
    }
  }

  function openFeature(feature: SpecFeature) {
    setError(null);
    setSelected(feature.slug);
    setRevisingSlug(null);
    setStep(phaseToStep(feature.phase));
    if (feature.phase === 'awaiting_validation') {
      void loadSpecBody(feature.slug);
    }
  }

  function startFresh() {
    setSelected(null);
    setRevisingSlug(null);
    setSpecMd('');
    setTitle('');
    setDescription('');
    setStep('intent');
    setError(null);
  }

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setRevisingSlug(null);
      setSpecMd('');
      setStep('intent');
      setTitle('');
      setDescription('');
      setError(null);
      return;
    }
    void load().then((list) => {
      // Reprendre la plus urgente si on ouvre à froid.
      const urgent =
        list.find((f) => f.phase === 'awaiting_validation') ||
        list.find((f) => f.phase === 'implement') ||
        list.find((f) => f.phase === 'failed') ||
        list.find((f) => f.phase === 'converged');
      if (urgent) openFeature(urgent);
      else startFresh();
    });
  }, [open, projectUuid]);

  // Pendant l’écriture, rafraîchir pour afficher le modèle et la fin.
  useEffect(() => {
    if (!open) return;
    const writing = features.some((f) => f.phase === 'implement');
    if (!writing) return;
    const id = window.setInterval(() => {
      void load().then((list) => {
        if (!selected) return;
        const updated = list.find((f) => f.slug === selected);
        if (updated) {
          const next = phaseToStep(updated.phase);
          setStep(next);
        }
      });
    }, 4000);
    return () => window.clearInterval(id);
  }, [open, projectUuid, selected, features.some((f) => f.phase === 'implement')]);

  async function submitIntent() {
    const t = title.trim();
    const d = description.trim();
    if (!t || !d) {
      setError('Titre et description sont requis.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (revisingSlug) {
        const r = await api.reviseProjectSpec(projectUuid, revisingSlug, {
          title: t,
          description: d,
        });
        setSpecMd(r.spec_md || '');
        setSelected(r.data.slug);
        setRevisingSlug(null);
        toast.push({
          title: 'Spec ajustée',
          detail: 'Relis-la, puis appuie sur Approuver.',
          tone: 'ok',
        });
        await load();
        setStep('spec');
      } else {
        const r = await api.createProjectSpec(projectUuid, { title: t, description: d });
        toast.push({
          title: 'Spec prête à lire',
          detail: 'Prochaine étape : Approuver (bouton).',
          tone: 'ok',
        });
        await load();
        setSelected(r.data.slug);
        await loadSpecBody(r.data.slug);
        setStep('spec');
      }
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
        setSpecMd('');
        setStep('intent');
        toast.push({
          title: 'Spec refusée',
          detail: 'Elle quitte la liste. Aucun code.',
          tone: 'ok',
        });
      } else {
        toast.push({
          title: 'Écriture lancée',
          detail: 'Le nom du modèle apparaît à l’étape Écriture.',
          tone: 'ok',
        });
        setStep('write');
      }
      await load();
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  async function beginAdjust() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.getProjectSpec(projectUuid, current.slug);
      const md = r.spec_md || '';
      setSpecMd(md);
      setTitle(r.data.title || current.title);
      // Extraire Intention côté client (même logique que le serveur).
      const intention = (() => {
        const lines = md.split('\n');
        let inIntention = false;
        const out: string[] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (/^##\s+Intention$/i.test(trimmed)) {
            inIntention = true;
            continue;
          }
          if (inIntention && trimmed.startsWith('## ')) break;
          if (inIntention) out.push(line);
        }
        return out.join('\n').trim();
      })();
      setDescription(intention || description);
      setRevisingSlug(current.slug);
      setStep('intent');
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
        detail: 'Le modèle reprend. Son nom apparaît ici.',
        tone: 'ok',
      });
      setStep('write');
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
      if (selected === slug) {
        startFresh();
      }
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

  const modalTitle = current
    ? current.title
    : revisingSlug
      ? 'Ajuster l’intention'
      : 'Nouvelle fonctionnalité';
  const modalDesc =
    step === 'intent'
      ? revisingSlug
        ? 'Modifie le titre et ce que tu veux, puis mets à jour la spec.'
        : 'Décris en français ce que tu veux. Ensuite tu liras la spec et tu Approuveras.'
      : step === 'spec'
        ? 'Lis la spec. Seul le bouton Approuver lance l’écriture — pas « oui » ni « go ».'
        : step === 'write'
          ? current?.phase === 'failed'
            ? 'L’écriture n’a pas abouti. Réessaie ou retire.'
            : 'Le modèle écrit. La publication n’est pas sur ce chemin.'
          : 'Ouvre la prévisualisation. Publier reste une action à part.';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={modalTitle}
      description={modalDesc}
    >
      <div class="space-y-4">
        <SpecStepper current={step} reached={current ? reached : step} />

        {error && <p class="text-sm text-[var(--color-danger)]">{error}</p>}

        {step === 'intent' && (
          <form
            class="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitIntent();
            }}
          >
            <Input
              label="Fonctionnalité"
              value={title}
              placeholder="Ex. page d'accueil"
              onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
            />
            <label class="flex min-w-0 w-full flex-col gap-1.5 text-sm">
              <span class="font-medium text-[var(--color-ink)]">Ce que tu veux</span>
              <textarea
                class="min-h-28 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent-soft)]"
                value={description}
                placeholder="En français, le comportement attendu."
                onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
              />
            </label>
            <div class="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                {revisingSlug ? 'Mettre à jour la spec' : 'Continuer → Spec'}
              </Button>
              {revisingSlug ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setRevisingSlug(null);
                    if (selected) {
                      setStep('spec');
                      void loadSpecBody(selected);
                    }
                  }}
                >
                  Annuler l’ajustement
                </Button>
              ) : null}
            </div>
          </form>
        )}

        {step === 'spec' && current && (
          <div class="space-y-4">
            <div class="rounded-2xl border border-[var(--color-line)] bg-black/20 p-4">
              <div class="mb-2 flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                <FileText size={14} aria-hidden />
                <span>specs/{current.slug}/spec.md</span>
              </div>
              <pre class="max-h-64 overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--color-ink)]">
                {specMd.trim() || 'Chargement de la spec…'}
              </pre>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy || !specMd.trim()} onClick={() => void decide(current.slug, 'approve')}>
                Approuver
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void beginAdjust()}>
                <span class="inline-flex items-center gap-1.5">
                  <Pencil size={14} aria-hidden />
                  Ajuster
                </span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void decide(current.slug, 'reject')}
              >
                Refuser
              </Button>
            </div>
            <p class="text-xs text-[var(--color-ink-muted)]">
              « oui » et « go » ne suffisent pas — seul Approuver lance l’écriture.
            </p>
          </div>
        )}

        {step === 'write' && current && (
          <div class="space-y-4">
            {current.phase === 'implement' ? (
              <div class="flex items-start gap-3 rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)]/40 px-4 py-3">
                <Loader2 size={20} class="mt-0.5 animate-spin text-[var(--color-accent)]" aria-hidden />
                <div class="min-w-0">
                  <div class="text-sm font-medium text-[var(--color-ink)]">
                    {modelName(current)
                      ? `Écriture en cours · ${modelName(current)}`
                      : 'Écriture en cours'}
                  </div>
                  <p class="mt-1 text-xs text-[var(--color-ink-muted)]">{writeDetail(current)}</p>
                  {modelName(current) ? (
                    <p class="mt-2 inline-flex items-center gap-1.5 rounded-full bg-black/20 px-2.5 py-1 text-[11px] text-[var(--color-ink)]">
                      <Sparkles size={12} aria-hidden />
                      Fournisseur : {modelName(current)}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <div class="space-y-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3">
                <div class="text-sm font-medium text-[var(--color-ink)]">
                  {statusBadge(current).label}
                </div>
                <p class="text-xs text-[var(--color-ink-muted)]">{writeDetail(current)}</p>
                <div class="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void retry(current.slug)}>
                    Réessayer
                  </Button>
                  {canDismiss(current) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void dismiss(current.slug)}
                    >
                      Retirer
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'preview' && current && (
          <div class="space-y-4">
            <div class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <div class="text-sm font-medium text-[var(--color-ink)]">Prête à prévisualiser</div>
              <p class="mt-1 text-xs text-[var(--color-ink-muted)]">
                {modelName(current)
                  ? `${modelName(current)} a terminé. Ouvre la prévisualisation. La publication reste une action à part.`
                  : 'La fonctionnalité est prête. Ouvre la prévisualisation. La publication reste une action à part.'}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void openPreview()}>
                Ouvrir la prévisualisation
              </Button>
              {canDismiss(current) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void dismiss(current.slug)}
                >
                  Retirer
                </Button>
              ) : null}
            </div>
          </div>
        )}

        {/* Liste compacte des autres specs — pas de carte détail sous une grille hub. */}
        <div class="border-t border-[var(--color-line)] pt-4">
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs font-medium text-[var(--color-ink-muted)]">
              {features.length === 0
                ? 'Aucune autre spec'
                : `${features.length} en cours`}
            </span>
            {selected || step !== 'intent' ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={startFresh}>
                + Nouvelle
              </Button>
            ) : null}
          </div>
          {features.length > 0 ? (
            <ul class="space-y-1.5">
              {features.map((feature) => {
                const badge = statusBadge(feature);
                const active = feature.slug === selected;
                const removable = showDismissSwitch(feature);
                return (
                  <li
                    key={feature.slug}
                    class={cn(
                      'flex items-center gap-2 rounded-xl px-2.5 py-2 ring-1 transition',
                      active
                        ? 'bg-[var(--color-accent-soft)]/50 ring-[var(--color-accent)]/40'
                        : 'bg-white/[0.02] ring-white/10 hover:bg-white/[0.04]',
                    )}
                  >
                    <button
                      type="button"
                      class="min-w-0 flex-1 text-left"
                      disabled={busy}
                      onClick={() => openFeature(feature)}
                    >
                      <div class="truncate text-sm font-medium text-[var(--color-ink)]">
                        {feature.title}
                      </div>
                      <div class="mt-0.5">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </div>
                    </button>
                    {removable ? (
                      <div
                        class="flex shrink-0 items-center gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <span class="text-[10px] text-[var(--color-ink-muted)]">Liste</span>
                        <Switch
                          checked
                          disabled={busy}
                          label={`Retirer ${feature.title}`}
                          onToggle={() => void dismiss(feature.slug)}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p class="text-xs text-[var(--color-ink-muted)]">
              Commence par l’intention ci-dessus. Les specs refusées ou retirées ne restent pas ici.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
