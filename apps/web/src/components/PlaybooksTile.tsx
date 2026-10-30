import { useEffect, useState } from 'preact/hooks';
import { Brain, Eye, Network, Rocket, Search } from 'lucide-preact';
import { api, type Playbook } from '../lib/api';
import { RunLiveCard } from './RunLiveCard';
import { Button, HubIcon, HubTile, Input, Modal, Spinner, useToast } from './ui';

const VISUALS: Record<string, typeof Rocket> = {
  rocket: Rocket,
  search: Search,
  eye: Eye,
  swarm: Network,
  brain: Brain,
};

const lastRunKey = (projectUuid: string) => `df.playbook-run.${projectUuid}`;

function readLastRun(projectUuid: string): string | null {
  try {
    return localStorage.getItem(lastRunKey(projectUuid));
  } catch {
    return null;
  }
}

/**
 * Tuile « Modèles » : bibliothèque de playbooks (commande slash, 3 étapes fixes, règle).
 * Un bouton « Lancer » par modèle ; la carte live du dernier lancement s'affiche en tête.
 */
export function PlaybooksTile({ projectUuid, index = 0 }: { projectUuid: string; index?: number }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Playbook[] | null>(null);
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [runUuid, setRunUuid] = useState<string | null>(() => readLastRun(projectUuid));

  useEffect(() => {
    if (!open || list) return;
    api
      .playbooks()
      .then((r) => setList(r.data))
      .catch((e) => toast.push({ title: 'Modèles indisponibles', detail: String((e as Error).message || e), tone: 'danger' }));
  }, [open]);

  async function launch(p: Playbook) {
    setBusy(p.id);
    try {
      const goal = (goals[p.id] || '').trim();
      const r = await api.runPlaybook(projectUuid, p.id, goal || undefined);
      setRunUuid(r.data.run_uuid);
      try {
        localStorage.setItem(lastRunKey(projectUuid), r.data.run_uuid);
      } catch {
        /* stockage indisponible : la carte reste visible tant que la modale est ouverte */
      }
      toast.push({ title: `${p.slash} lancé`, detail: p.name, tone: 'ok' });
    } catch (e) {
      toast.push({ title: 'Lancement impossible', detail: String((e as Error).message || e), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <HubTile
        index={index}
        title="Modèles"
        description="Déployer, enquêter, surveiller, essaim…"
        icon={<HubIcon name="network" />}
        onClick={() => setOpen(true)}
      />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Modèles d'agent"
        description="Un bouton, trois étapes fixes, une règle."
        size="lg"
        fullOnMobile
      >
        <div class="space-y-4">
          {runUuid && (
            <div>
              <div class="mb-1.5 flex items-center justify-between gap-2">
                <span class="text-xs font-medium text-[var(--color-ink-muted)]">Dernier lancement</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRunUuid(null);
                    try {
                      localStorage.removeItem(lastRunKey(projectUuid));
                    } catch {
                      /* rien */
                    }
                  }}
                >
                  Masquer
                </Button>
              </div>
              <RunLiveCard key={runUuid} runUuid={runUuid} />
            </div>
          )}

          {!list ? (
            <div class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
              <Spinner /> Chargement…
            </div>
          ) : (
            <ul class="grid grid-cols-1 gap-3 md:grid-cols-2">
              {list.map((p) => {
                const Icon = VISUALS[p.visual] || Rocket;
                return (
                  <li key={p.id} class="flex flex-col rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3" data-testid={`playbook-${p.id}`}>
                    <div class="flex items-start gap-2.5">
                      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                        <Icon size={18} aria-hidden />
                      </span>
                      <div class="min-w-0 flex-1">
                        <div class="font-mono text-xs text-[var(--color-accent)]">{p.slash}</div>
                        <div class="text-sm font-semibold text-[var(--color-ink)]">{p.name}</div>
                      </div>
                    </div>
                    <p class="mt-2 text-xs leading-snug text-[var(--color-ink-muted)]">{p.description}</p>
                    <ol class="mt-2 space-y-1">
                      {p.steps.map((s, i) => (
                        <li key={i} class="flex items-start gap-2 text-xs text-[var(--color-ink)]">
                          <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[10px] font-semibold">
                            {i + 1}
                          </span>
                          <span class="leading-snug">{s}</span>
                        </li>
                      ))}
                    </ol>
                    <p class="mt-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-[var(--color-ink-muted)]">
                      <span class="font-medium text-[var(--color-warn)]">Règle :</span> {p.rule}
                    </p>
                    {p.goal_label && (
                      <div class="mt-2">
                        <Input
                          label={p.goal_label}
                          id={`pb-goal-${p.id}`}
                          placeholder={p.goal_placeholder}
                          maxLength={300}
                          value={goals[p.id] || ''}
                          onInput={(e) => setGoals((g) => ({ ...g, [p.id]: (e.target as HTMLInputElement).value }))}
                        />
                      </div>
                    )}
                    <div class="mt-auto flex justify-end pt-3">
                      <Button type="button" size="sm" disabled={busy !== null} onClick={() => void launch(p)}>
                        {busy === p.id ? <Spinner /> : null}
                        Lancer
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}
