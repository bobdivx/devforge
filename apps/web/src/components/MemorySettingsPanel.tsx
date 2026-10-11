import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Bot, Cpu, History, Pencil, Pin, PinOff, Plus, Search, Trash2, User } from 'lucide-preact';
import { api, type MemoryItem, type MemoryList, type MemoryTier } from '../lib/api';
import { cn } from '../lib/cn';
import {
  budgetState,
  KIND_LABELS,
  relativeAgo,
  relativeUntil,
  scopeLabel,
  sourceLabel,
  TIER_TABS,
} from '../lib/memory-ui';
import { Alert, Badge, Button, Modal, Skeleton, useToast } from './ui';

/** Sous-ensemble de l'API utilisé par le panneau (injectable pour les tests). */
export type MemoryClient = Pick<
  typeof api,
  'memoryList' | 'memoryCreate' | 'memoryCorrect' | 'memoryForget' | 'memoryPin' | 'memoryHistory' | 'memoryEraseAll'
>;

const ADD_KINDS: Record<MemoryTier, string[]> = {
  profile: ['preference', 'fact', 'infra'],
  log: ['decision', 'incident', 'fact'],
  note: ['context', 'todo'],
};

function SourceIcon({ tone }: { tone: 'user' | 'agent' | 'system' }) {
  const Icon = tone === 'user' ? User : tone === 'agent' ? Bot : Cpu;
  return <Icon size={12} class="shrink-0" aria-hidden />;
}

function MemoryRow({
  item,
  client,
  onChanged,
  onRemoved,
}: {
  item: MemoryItem;
  client: MemoryClient;
  onChanged: () => void;
  onRemoved: (uuid: string) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const [busy, setBusy] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [history, setHistory] = useState<MemoryItem[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const src = sourceLabel(item);

  const save = async () => {
    const text = draft.trim();
    if (!text || text === item.content) {
      setEditing(false);
      return;
    }
    setBusy('save');
    try {
      await client.memoryCorrect(item.uuid, text);
      toast.push({ tone: 'ok', title: 'Souvenir corrigé', detail: 'Pris en compte dès le prochain message.' });
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.push({ tone: 'danger', title: 'Correction refusée', detail: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const togglePin = async () => {
    setBusy('pin');
    try {
      await client.memoryPin(item.uuid, !item.pinned);
      onChanged();
    } catch (e) {
      toast.push({ tone: 'danger', title: 'Action impossible', detail: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const forget = async () => {
    setBusy('forget');
    try {
      await client.memoryForget(item.uuid);
      setLeaving(true);
      // Laisse le repli (200 ms, nul sous reduced-motion) se jouer avant de retirer la ligne.
      window.setTimeout(() => onRemoved(item.uuid), 220);
    } catch (e) {
      setBusy(null);
      toast.push({ tone: 'danger', title: 'Oubli impossible', detail: (e as Error).message });
    }
  };

  const toggleHistory = async () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history === null) {
      try {
        setHistory((await client.memoryHistory(item.uuid)).items);
      } catch {
        setHistory([]);
      }
    }
  };

  return (
    <li class="df-collapse" data-open={leaving ? 'false' : 'true'} data-testid="memory-row" data-uuid={item.uuid}>
      <div class={cn('min-h-0 overflow-hidden transition-opacity duration-200 motion-reduce:transition-none', leaving && 'opacity-0')}>
        <div class="border-b border-[var(--color-line)] px-1 py-3 last:border-b-0">
          {editing ? (
            <div class="space-y-2">
              <label class="sr-only" for={`mem-edit-${item.uuid}`}>
                Corriger le souvenir
              </label>
              <textarea
                id={`mem-edit-${item.uuid}`}
                class="min-h-[88px] w-full resize-y rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                value={draft}
                maxLength={2000}
                onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
              />
              <div class="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setDraft(item.content); setEditing(false); }}>
                  Annuler
                </Button>
                <Button size="sm" onClick={save} disabled={busy === 'save'}>
                  Enregistrer
                </Button>
              </div>
            </div>
          ) : (
            <p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--color-ink)]">{item.content}</p>
          )}
          <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-faint)]">
            <Badge tone={item.scope === 'user' ? 'accent' : 'neutral'}>{scopeLabel(item)}</Badge>
            <span>{KIND_LABELS[item.kind] ?? item.kind}</span>
            <span aria-hidden>·</span>
            <span title={new Date(item.updated_at).toLocaleString('fr-FR')}>{relativeAgo(item.updated_at)}</span>
            {item.tier === 'note' && item.expires_at ? (
              <>
                <span aria-hidden>·</span>
                <span>{relativeUntil(item.expires_at)}</span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span class={cn('inline-flex items-center gap-1', src.tone === 'agent' && item.inferred && 'text-[var(--color-warn)]')}>
              <SourceIcon tone={src.tone} />
              {src.text}
            </span>
            {item.pinned ? (
              <span class="inline-flex items-center gap-1 text-[var(--color-accent)]">
                <Pin size={12} aria-hidden /> épinglé
              </span>
            ) : null}
          </div>
          {!editing && (
            <div class="mt-1 flex flex-wrap items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label="Corriger ce souvenir">
                <Pencil size={13} aria-hidden /> Corriger
              </Button>
              {item.tier === 'profile' && (
                <Button size="sm" variant="ghost" onClick={togglePin} disabled={busy === 'pin'} aria-pressed={item.pinned}>
                  {item.pinned ? <PinOff size={13} aria-hidden /> : <Pin size={13} aria-hidden />}
                  {item.pinned ? 'Désépingler' : 'Épingler'}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={forget} disabled={busy === 'forget'} class="hover:!text-[var(--color-danger)]">
                <Trash2 size={13} aria-hidden /> Oublier
              </Button>
              {(item.versions ?? 0) > 0 && (
                <Button size="sm" variant="ghost" onClick={toggleHistory} aria-expanded={historyOpen}>
                  <History size={13} aria-hidden /> Versions précédentes
                </Button>
              )}
            </div>
          )}
          <div class="df-collapse" data-open={historyOpen ? 'true' : 'false'}>
            <div class="min-h-0 overflow-hidden">
              {historyOpen && (
                <ol class="mt-2 space-y-1.5 border-l border-[var(--color-line-strong)] pl-3" aria-label="Versions précédentes">
                  {history === null ? (
                    <li class="text-xs text-[var(--color-ink-faint)]">Chargement…</li>
                  ) : history.length === 0 ? (
                    <li class="text-xs text-[var(--color-ink-faint)]">Aucune version précédente.</li>
                  ) : (
                    history.map((h) => (
                      <li key={h.uuid} class="text-xs text-[var(--color-ink-muted)]">
                        <span class="line-through decoration-white/30">{h.content}</span>
                        <span class="ml-1.5 text-[var(--color-ink-faint)]">· {relativeAgo(h.updated_at)}</span>
                      </li>
                    ))
                  )}
                </ol>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function AddForm({ tier, client, onDone }: { tier: MemoryTier; client: MemoryClient; onDone: () => void }) {
  const toast = useToast();
  const [content, setContent] = useState('');
  const [kind, setKind] = useState(ADD_KINDS[tier][0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await client.memoryCreate({ content: content.trim(), tier, kind, scope: 'user' });
      toast.push({ tone: 'ok', title: 'Souvenir ajouté', detail: 'Tes agents le liront dès le prochain message.' });
      setContent('');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} class="space-y-2 rounded-2xl border border-[var(--color-line)] bg-white/[0.02] p-3" data-testid="memory-add">
      <label class="block text-sm font-medium" for="mem-add">
        Nouveau souvenir (toutes tes apps)
      </label>
      <textarea
        id="mem-add"
        class="min-h-[72px] w-full resize-y rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        placeholder="Ex. Je préfère des réponses courtes, en français."
        maxLength={2000}
        value={content}
        onInput={(e) => setContent((e.target as HTMLTextAreaElement).value)}
      />
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex flex-wrap gap-1" role="radiogroup" aria-label="Type">
          {ADD_KINDS[tier].map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              class={cn(
                'rounded-full px-3 py-1 text-xs ring-1 ring-inset transition',
                kind === k
                  ? 'bg-[var(--color-accent)]/15 text-[var(--color-ink)] ring-[var(--color-accent)]/50'
                  : 'text-[var(--color-ink-muted)] ring-[var(--color-line-strong)] hover:bg-white/5',
              )}
              onClick={() => setKind(k)}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <Button type="submit" size="sm" class="ml-auto" disabled={busy || !content.trim()}>
          Ajouter
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <p class="text-xs text-[var(--color-ink-faint)]">Jamais de mot de passe ni de jeton : ils sont refusés automatiquement.</p>
    </form>
  );
}

export function MemorySettingsPanel({ client = api }: { client?: MemoryClient }) {
  const toast = useToast();
  const [tier, setTier] = useState<MemoryTier>('profile');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<MemoryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [erasing, setErasing] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await client.memoryList({ tier, q: query.trim() || undefined });
      if (mine === seq.current) {
        setData(res);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    }
  }, [client, tier, query]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), query ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [load, query]);

  const removeLocal = (uuid: string) =>
    setData((d) => (d ? { ...d, items: d.items.filter((i) => i.uuid !== uuid) } : d));

  const eraseAll = async () => {
    setErasing(true);
    try {
      const r = await client.memoryEraseAll();
      toast.push({ tone: 'ok', title: 'Mémoire effacée', detail: `${r.erased} souvenir${r.erased > 1 ? 's' : ''} supprimé${r.erased > 1 ? 's' : ''}.` });
      setEraseOpen(false);
      void load();
    } catch (e) {
      toast.push({ tone: 'danger', title: 'Effacement impossible', detail: (e as Error).message });
    } finally {
      setErasing(false);
    }
  };

  const tab = TIER_TABS.find((t) => t.key === tier)!;
  const budget = data ? budgetState(data.profile_budget.used, data.profile_budget.max) : null;

  return (
    <div class="df-tap space-y-4" data-testid="memory-panel">
      <p class="text-sm text-[var(--color-ink-muted)]">
        Ce que tes agents retiennent d’une conversation à l’autre. Tu peux tout corriger ou oublier : c’est pris en compte au message suivant.
      </p>

      <div role="tablist" aria-label="Type de souvenirs" class="flex gap-1 rounded-xl bg-white/[0.03] p-1 ring-1 ring-inset ring-[var(--color-line)]">
        {TIER_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`mem-tab-${t.key}`}
            aria-selected={tier === t.key}
            aria-controls="mem-tabpanel"
            class={cn(
              'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
              tier === t.key ? 'bg-[var(--color-surface-2)] text-[var(--color-ink)] shadow' : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
            )}
            onClick={() => {
              setTier(t.key);
              setAdding(false);
              setData(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="mem-tabpanel" role="tabpanel" aria-labelledby={`mem-tab-${tier}`} class="space-y-3">
        <p class="text-xs text-[var(--color-ink-faint)]">{tab.hint}</p>

        {tier === 'profile' && budget && data && (
          <div data-testid="memory-budget">
            <div class="mb-1 flex items-center justify-between text-xs">
              <span class="text-[var(--color-ink-muted)]">Profil lu à chaque message</span>
              <span class={cn(budget.tone === 'ok' ? 'text-[var(--color-ink-faint)]' : budget.tone === 'warn' ? 'text-[var(--color-warn)]' : 'text-[var(--color-danger)]')}>
                {data.profile_budget.used.toLocaleString('fr-FR')} / {data.profile_budget.max.toLocaleString('fr-FR')} caractères
              </span>
            </div>
            <div
              class="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-label="Budget du profil"
              aria-valuemin={0}
              aria-valuemax={data.profile_budget.max}
              aria-valuenow={data.profile_budget.used}
            >
              <div
                class={cn(
                  'h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none',
                  budget.tone === 'ok' ? 'bg-[var(--color-accent)]' : budget.tone === 'warn' ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-danger)]',
                )}
                style={{ width: `${budget.pct}%` }}
              />
            </div>
            {budget.tone !== 'ok' && (
              <p class="mt-1 text-xs text-[var(--color-warn)]">
                Le profil approche de sa limite : regroupe ou oublie les souvenirs les moins utiles, sinon les plus anciens ne seront plus lus.
              </p>
            )}
          </div>
        )}

        <div class="flex flex-wrap items-center gap-2">
          <label class="relative min-w-0 flex-1">
            <span class="sr-only">Chercher dans la mémoire</span>
            <Search size={14} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" aria-hidden />
            <input
              type="search"
              class="h-10 w-full rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] pl-9 pr-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] max-lg:h-11"
              placeholder="Chercher…"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
          </label>
          {tier !== 'note' && (
            <Button size="sm" variant={adding ? 'ghost' : 'secondary'} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
              <Plus size={14} aria-hidden /> {adding ? 'Fermer' : 'Ajouter'}
            </Button>
          )}
        </div>

        {adding && <AddForm tier={tier} client={client} onDone={() => { setAdding(false); void load(); }} />}

        {error && <Alert tone="danger">{error}</Alert>}

        {!data && !error ? (
          <div class="space-y-2" aria-busy="true">
            <Skeleton class="h-14" />
            <Skeleton class="h-14" />
          </div>
        ) : data && data.items.length === 0 ? (
          <div class="rounded-2xl border border-dashed border-[var(--color-line-strong)] px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]" data-testid="memory-empty">
            {query
              ? 'Aucun souvenir ne correspond.'
              : tier === 'profile'
                ? 'Rien pour l’instant. Dis à Braise « retiens que… » ou ajoute un souvenir ici.'
                : tier === 'log'
                  ? 'Le journal se remplit avec les décisions, incidents et déploiements.'
                  : 'Aucune note en cours.'}
          </div>
        ) : data ? (
          <ul class="rounded-2xl border border-[var(--color-line)] bg-white/[0.02] px-3" aria-live="polite">
            {data.items.map((item) => (
              <MemoryRow key={item.uuid} item={item} client={client} onChanged={() => void load()} onRemoved={removeLocal} />
            ))}
          </ul>
        ) : null}
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] pt-4">
        <p class="text-xs text-[var(--color-ink-faint)]">« Tout effacer » supprime définitivement toute ta mémoire, sur toutes les apps.</p>
        <Button size="sm" variant="ghost" class="!text-[var(--color-danger)] hover:!bg-red-500/10" onClick={() => setEraseOpen(true)}>
          <Trash2 size={14} aria-hidden /> Tout effacer
        </Button>
      </div>

      <Modal
        open={eraseOpen}
        onClose={() => setEraseOpen(false)}
        title="Effacer toute la mémoire ?"
        description="Profil, journal et notes : tout est supprimé définitivement, pour tous tes agents. Impossible d’annuler."
        size="sm"
        footer={
          <div class="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEraseOpen(false)}>
              Annuler
            </Button>
            <Button variant="danger" onClick={eraseAll} disabled={erasing}>
              Tout effacer
            </Button>
          </div>
        }
      >
        <p class="text-sm text-[var(--color-ink-muted)]">Tes agents repartiront de zéro au prochain message.</p>
      </Modal>
    </div>
  );
}
