import { useEffect, useState } from 'preact/hooks';
import { FileText } from 'lucide-preact';
import { api, type SpecFeature } from '../lib/api';
import { Badge, Button, HubTile, Input, Modal, useToast } from './ui';

const PHASES: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' | 'accent' }> = {
  awaiting_validation: { label: 'En attente de validation', tone: 'warn' },
  implement: { label: 'Implémentation', tone: 'accent' },
  converged: { label: 'Convergé', tone: 'ok' },
  failed: { label: 'Échec', tone: 'danger' },
  rejected: { label: 'Rejetée', tone: 'neutral' },
};

function phaseOf(phase: string) {
  return PHASES[phase] ?? { label: phase, tone: 'neutral' as const };
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
  }, [open, projectUuid]);

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
      toast.push({ title: 'Spec écrite', detail: 'Valide-la avant tout code.', tone: 'ok' });
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
        title: decision === 'approve' ? 'Spec validée' : 'Spec rejetée',
        detail: decision === 'approve' ? 'Implémentation locale lancée.' : 'Aucun code.',
        tone: 'ok',
      });
      await load();
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  async function converge(slug: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.convergeProjectSpec(projectUuid, slug);
      const phase = phaseOf(r.data.phase).label;
      toast.push({ title: 'Convergence', detail: phase, tone: 'ok' });
      await load();
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  const waiting = features.filter((f) => f.phase === 'awaiting_validation').length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Nouvelle fonctionnalité"
      description={
        waiting > 0
          ? `${waiting} spec en attente. Prochaine étape : Approuver la spec. « oui » et « go » ne comptent pas.`
          : 'Prochaine étape : écrire la spec, puis l’approuver. Aucun dépôt n’est créé.'
      }
    >
      <div class="space-y-5">
        {error && <p class="text-sm text-[var(--color-danger)]">{error}</p>}
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
            Écrit specs/constitution.md une fois (qualité, tests, maintenabilité) et
            specs/&lt;slug&gt;/spec.md. Le Coordinateur s'arrête là. « oui » ou « go » ne lancent
            pas le code.
          </p>
        </form>

        <ul class="space-y-3">
          {features.length === 0 && (
            <li class="text-sm text-[var(--color-ink-muted)]">Aucune spec pour l'instant.</li>
          )}
          {features.map((feature) => {
            const phase = phaseOf(feature.phase);
            return (
              <li
                key={feature.slug}
                class="rounded-xl border border-[var(--color-line)] p-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-medium text-[var(--color-ink)]">{feature.title}</span>
                  <Badge tone={phase.tone}>{phase.label}</Badge>
                </div>
                <p class="mt-1 text-xs text-[var(--color-ink-faint)]">
                  specs/{feature.slug}/ · essai {feature.attempts}
                </p>
                {feature.note && (
                  <p class="mt-2 text-sm text-[var(--color-ink-muted)]">{feature.note}</p>
                )}
                <div class="mt-3 flex flex-wrap gap-2">
                  {feature.phase === 'awaiting_validation' && (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void decide(feature.slug, 'approve')}
                      >
                        Approuver la spec
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void decide(feature.slug, 'reject')}
                      >
                        Rejeter
                      </Button>
                    </>
                  )}
                  {feature.phase === 'implement' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void converge(feature.slug)}
                    >
                      Vérifier la convergence
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
