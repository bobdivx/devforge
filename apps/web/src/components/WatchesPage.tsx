import { useEffect, useState } from 'preact/hooks';
import { Eye, Search, Tag } from 'lucide-preact';
import { api, type PageWatch, type WatchCheck } from '../lib/api';
import { cn } from '../lib/cn';
import {
  CURRENCIES,
  INTERVALS,
  KINDS,
  checkOutcome,
  emptyForm,
  formFromWatch,
  formToInput,
  formatWhen,
  hostOf,
  watchDetails,
  watchStatus,
  watchSubtitle,
  type Tone,
  type WatchForm,
} from '../lib/watches';
import { AppShell } from './AppShell';
import { Alert, Badge, Button, HubAddTile, HubGrid, HubTile, Input, Modal, Skeleton } from './ui';

const DOT: Record<Tone, string> = {
  ok: 'bg-[var(--color-ok)]',
  danger: 'bg-[var(--color-danger)]',
  warn: 'bg-[var(--color-warn)]',
  accent: 'bg-[var(--color-accent)]',
  neutral: 'bg-[var(--color-ink-faint)]',
};

const TEXT: Record<Tone, string> = {
  ok: 'text-[var(--color-ok)]',
  danger: 'text-[var(--color-danger)]',
  warn: 'text-[var(--color-warn)]',
  accent: 'text-[var(--color-accent)]',
  neutral: 'text-[var(--color-ink-muted)]',
};

function KindIcon({ kind }: { kind: string }) {
  if (kind === 'price') return <Tag size={24} aria-hidden />;
  if (kind === 'text') return <Search size={24} aria-hidden />;
  return <Eye size={24} aria-hidden />;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** P3 : surveillance de pages — tuiles, détail et formulaire en modale. */
export function WatchesPage() {
  const [items, setItems] = useState<PageWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<PageWatch | 'new' | null>(null);

  async function load() {
    try {
      const r = await api.watches();
      setItems(r.data ?? []);
      setError('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Ouverture directe depuis une alerte : /app/watches?open=<uuid>.
    const id = new URLSearchParams(window.location.search).get('open');
    if (id) setOpen(id);
  }, []);

  // Relecture douce : plus rapide tant qu'une première lecture est attendue.
  const pending = items.some((w) => w.status === 'active' && !w.last_check_at);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, pending ? 4000 : 30000);
    return () => window.clearInterval(timer);
  }, [pending]);

  function upsert(w: PageWatch) {
    setItems((prev) => {
      const i = prev.findIndex((x) => x.uuid === w.uuid);
      if (i < 0) return [w, ...prev];
      const next = prev.slice();
      next[i] = w;
      return next;
    });
  }

  return (
    <AppShell
      active="settings"
      title="Surveillance"
      description="Des pages publiques relues pour toi : changement, texte ou prix."
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <HubGrid cols={5}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} class="aspect-square rounded-2xl" />
          ))}
        </HubGrid>
      ) : (
        <>
          <HubGrid cols={5}>
            {items.map((w, i) => {
              const st = watchStatus(w);
              return (
                <HubTile
                  key={w.uuid}
                  index={i}
                  title={w.name}
                  icon={<KindIcon kind={w.kind} />}
                  badge={
                    <span
                      class={cn(
                        'absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--color-bg)]',
                        DOT[st.tone],
                      )}
                      aria-hidden
                    />
                  }
                  subtitle={
                    <div class="mt-1 space-y-0.5 text-[11px] leading-snug">
                      <div class="truncate text-[var(--color-ink-muted)]">{watchSubtitle(w)}</div>
                      <div class="truncate">
                        <span class={TEXT[st.tone]}>{st.label}</span>
                        {w.last_check_at ? (
                          <span class="text-[var(--color-ink-faint)]"> · {formatWhen(w.last_check_at)}</span>
                        ) : null}
                      </div>
                    </div>
                  }
                  layout="auto"
                  onClick={() => setOpen(w.uuid)}
                />
              );
            })}
            <HubAddTile label="Nouvelle" index={items.length} layout="auto" onClick={() => setEditing('new')} />
          </HubGrid>
          {items.length === 0 ? (
            <p class="py-8 text-center text-sm text-[var(--color-ink-muted)]">
              Colle l’adresse d’une page : DevForge la relit et te prévient quand elle change, quand un texte
              apparaît ou quand un prix passe sous ton seuil.
            </p>
          ) : null}
        </>
      )}

      <WatchModal
        uuid={open}
        onClose={() => {
          setOpen(null);
          void load();
        }}
        onEdit={(w) => {
          setOpen(null);
          setEditing(w);
        }}
        onChanged={upsert}
        onDeleted={(uuid) => {
          setOpen(null);
          setItems((prev) => prev.filter((x) => x.uuid !== uuid));
        }}
      />
      <WatchFormModal
        watch={editing}
        onClose={() => setEditing(null)}
        onSaved={(w) => {
          setEditing(null);
          upsert(w);
          setOpen(w.uuid);
        }}
      />
    </AppShell>
  );
}

function WatchModal({
  uuid,
  onClose,
  onEdit,
  onChanged,
  onDeleted,
}: {
  uuid: string | null;
  onClose: () => void;
  onEdit: (w: PageWatch) => void;
  onChanged: (w: PageWatch) => void;
  onDeleted: (uuid: string) => void;
}) {
  const [watch, setWatch] = useState<PageWatch | null>(null);
  const [checks, setChecks] = useState<WatchCheck[]>([]);
  const [busy, setBusy] = useState<'' | 'run' | 'pause' | 'resume' | 'delete'>('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function refresh(id: string) {
    try {
      const r = await api.watch(id);
      setWatch(r.data);
      setChecks(r.checks ?? []);
      onChanged(r.data);
    } catch (e) {
      setError(errorText(e));
    }
  }

  useEffect(() => {
    setWatch(null);
    setChecks([]);
    setError('');
    setConfirmDelete(false);
    if (uuid) void refresh(uuid);
  }, [uuid]);

  // Première lecture en cours : on relit jusqu'au résultat.
  useEffect(() => {
    if (!uuid || !watch || watch.last_check_at || watch.status !== 'active') return;
    const t = window.setTimeout(() => void refresh(uuid), 3000);
    return () => window.clearTimeout(t);
  }, [uuid, watch]);

  async function act(kind: 'run' | 'pause' | 'resume') {
    if (!watch) return;
    setBusy(kind);
    setError('');
    try {
      if (kind === 'run') await api.runWatch(watch.uuid);
      if (kind === 'pause') await api.pauseWatch(watch.uuid);
      if (kind === 'resume') await api.resumeWatch(watch.uuid);
      await refresh(watch.uuid);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    if (!watch) return;
    setBusy('delete');
    setError('');
    try {
      await api.deleteWatch(watch.uuid);
      setConfirmDelete(false);
      onDeleted(watch.uuid);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  if (!uuid) return null;
  const st = watch ? watchStatus(watch) : null;
  return (
    <>
      <Modal
        open={!!uuid && !confirmDelete}
        onClose={onClose}
        title={watch?.name ?? 'Surveillance'}
        description={watch ? hostOf(watch.url) : undefined}
        size="md"
        fullOnMobile
        footer={
          watch ? (
            <div class="flex flex-wrap gap-2">
              {watch.status === 'active' ? (
                <Button onClick={() => void act('run')} disabled={!!busy} class="flex-1">
                  {busy === 'run' ? 'Lecture…' : 'Vérifier maintenant'}
                </Button>
              ) : (
                <Button onClick={() => void act('resume')} disabled={!!busy} class="flex-1">
                  {busy === 'resume' ? 'Reprise…' : 'Reprendre'}
                </Button>
              )}
              {watch.status === 'active' ? (
                <Button variant="secondary" onClick={() => void act('pause')} disabled={!!busy}>
                  Pause
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => onEdit(watch)} disabled={!!busy}>
                Modifier
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={!!busy}>
                Supprimer
              </Button>
            </div>
          ) : undefined
        }
      >
        {!watch ? (
          error ? <Alert tone="danger">{error}</Alert> : <Skeleton class="h-40 rounded-xl" />
        ) : (
          <div class="space-y-4">
            <div class="flex flex-wrap items-center gap-2">
              {st ? <Badge tone={st.tone}>{st.label}</Badge> : null}
              {watch.kind !== 'change' && watch.last_value ? <Badge tone="neutral">{watch.last_value}</Badge> : null}
            </div>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {watch.last_error ? (
              <p class="rounded-xl bg-red-500/10 px-3 py-2 text-sm leading-relaxed text-[var(--color-danger)] [overflow-wrap:anywhere]">
                {watch.last_error}
                {watch.status === 'paused' && watch.paused_reason === 'failures'
                  ? ' Mise en pause après 5 échecs d’affilée : reprends-la quand la page répond.'
                  : watch.failure_streak > 0
                    ? ' Nouvel essai automatique, de plus en plus espacé (60 min au plus).'
                    : ''}
              </p>
            ) : watch.last_summary ? (
              <p class="rounded-xl bg-white/5 px-3 py-2 text-sm leading-relaxed text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
                {watch.last_summary}
              </p>
            ) : null}
            <dl class="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
              {watchDetails(watch).map((row) => (
                <div key={row.label} class="flex items-start justify-between gap-4 px-3 py-2.5 text-sm">
                  <dt class="shrink-0 text-[var(--color-ink-muted)]">{row.label}</dt>
                  <dd class="min-w-0 text-right text-white [overflow-wrap:anywhere]">{row.value}</dd>
                </div>
              ))}
            </dl>
            <a
              href={watch.url}
              target="_blank"
              rel="noopener noreferrer"
              class="block truncate text-center text-sm text-[var(--color-accent)] hover:underline"
            >
              Ouvrir la page
            </a>
            {checks.length > 0 ? (
              <div>
                <p class="mb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                  Dernières lectures
                </p>
                <ul class="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
                  {checks.slice(0, 10).map((c) => {
                    const o = checkOutcome(c);
                    return (
                      <li key={c.uuid} class="flex items-start gap-2.5 px-3 py-2 text-sm">
                        <span class={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT[o.tone])} aria-hidden />
                        <span class="min-w-0 flex-1">
                          <span class="flex justify-between gap-2">
                            <span class={TEXT[o.tone]}>
                              {o.label}
                              {c.alerted ? ' · alerte' : ''}
                            </span>
                            <span class="shrink-0 text-[11px] text-[var(--color-ink-faint)]">{formatWhen(c.checked_at)}</span>
                          </span>
                          {c.error || c.summary ? (
                            <span class="block text-[12px] leading-snug text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
                              {c.error ?? c.summary}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Modal>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Supprimer cette surveillance ?"
        description={watch?.name}
        size="sm"
        footer={
          <div class="flex gap-2">
            <Button variant="secondary" class="flex-1" onClick={() => setConfirmDelete(false)} disabled={busy === 'delete'}>
              Annuler
            </Button>
            <Button variant="danger" class="flex-1" onClick={() => void remove()} disabled={busy === 'delete'}>
              {busy === 'delete' ? 'Suppression…' : 'Supprimer'}
            </Button>
          </div>
        }
      >
        <p class="text-sm text-[var(--color-ink-muted)]">
          La page ne sera plus relue. Son historique et ses alertes sont effacés.
        </p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </Modal>
    </>
  );
}

function Pills<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div class="flex flex-col gap-1.5 text-sm">
      <span class="font-medium text-[var(--color-ink)]">{label}</span>
      <div class="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.key)}
            type="button"
            role="radio"
            aria-checked={value === o.key}
            onClick={() => onChange(o.key)}
            class={cn(
              'inline-flex min-h-[40px] items-center rounded-full px-3.5 text-xs font-medium transition-colors active:scale-[0.97] max-lg:min-h-[44px]',
              value === o.key
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'bg-white/5 text-[var(--color-ink-muted)] hover:text-white',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WatchFormModal({
  watch,
  onClose,
  onSaved,
}: {
  watch: PageWatch | 'new' | null;
  onClose: () => void;
  onSaved: (w: PageWatch) => void;
}) {
  const [form, setForm] = useState<WatchForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    setForm(watch && watch !== 'new' ? formFromWatch(watch) : emptyForm());
  }, [watch]);

  if (!watch) return null;
  const isNew = watch === 'new';
  const set = <K extends keyof WatchForm>(k: K, v: WatchForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const hint = KINDS.find((k) => k.key === form.kind)?.hint;

  async function save(e?: Event) {
    e?.preventDefault();
    const r = formToInput(form);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = isNew ? await api.createWatch(r.input) : await api.updateWatch((watch as PageWatch).uuid, r.input);
      onSaved(res.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!watch}
      onClose={onClose}
      title={isNew ? 'Nouvelle surveillance' : 'Modifier la surveillance'}
      size="md"
      fullOnMobile
      footer={
        <div class="flex gap-2">
          <Button variant="secondary" class="flex-1" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button class="flex-1" onClick={() => void save()} disabled={saving}>
            {saving ? 'Enregistrement…' : isNew ? 'Surveiller' : 'Enregistrer'}
          </Button>
        </div>
      }
    >
      <form class="space-y-4" onSubmit={(e) => void save(e)}>
        <Input
          label="Adresse de la page"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://exemple.fr/produit"
          value={form.url}
          onInput={(e) => set('url', (e.target as HTMLInputElement).value)}
          hint="Pages publiques uniquement : pas d’adresse interne ni d’identifiants."
          autoFocus={isNew}
        />
        <Pills label="Prévenir quand" value={form.kind} options={KINDS} onChange={(v) => set('kind', v)} />
        {hint ? <p class="-mt-2 text-xs text-[var(--color-ink-muted)]">{hint}</p> : null}
        {form.kind === 'text' ? (
          <>
            <Input
              label="Texte à guetter"
              placeholder="En stock"
              value={form.text}
              onInput={(e) => set('text', (e.target as HTMLInputElement).value)}
            />
            <Pills
              label="Prévenir s’il"
              value={form.text_mode}
              options={[
                { key: 'appears', label: 'Apparaît' },
                { key: 'disappears', label: 'Disparaît' },
              ]}
              onChange={(v) => set('text_mode', v)}
            />
          </>
        ) : null}
        {form.kind === 'price' ? (
          <>
            <Pills
              label="Prix"
              value={form.price_op}
              options={[
                { key: 'below', label: 'Sous le seuil' },
                { key: 'above', label: 'Au-dessus' },
              ]}
              onChange={(v) => set('price_op', v)}
            />
            <div class="grid grid-cols-[1fr_auto] items-end gap-2">
              <Input
                label="Seuil"
                inputMode="decimal"
                placeholder="99,90"
                value={form.threshold}
                onInput={(e) => set('threshold', (e.target as HTMLInputElement).value)}
              />
              <select
                aria-label="Devise"
                value={form.currency}
                onChange={(e) => set('currency', (e.target as HTMLSelectElement).value)}
                class="h-11 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-ink)] sm:text-sm lg:h-10"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Repère (facultatif)"
              placeholder="Nom du produit, près du prix"
              value={form.text}
              onInput={(e) => set('text', (e.target as HTMLInputElement).value)}
              hint="Si la page affiche plusieurs prix, le premier après ce texte est suivi."
            />
          </>
        ) : null}
        <Pills
          label="Relire toutes les"
          value={form.interval_minutes}
          options={INTERVALS.map((i) => ({ key: i.minutes, label: i.label }))}
          onChange={(v) => set('interval_minutes', v)}
        />
        <Input
          label="Nom (facultatif)"
          placeholder="Par défaut : le domaine"
          value={form.name}
          onInput={(e) => set('name', (e.target as HTMLInputElement).value)}
        />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <button type="submit" class="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
