import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  api,
  type DockerGcNodeDisk,
  type DockerGcPreview,
  type DockerGcRun,
  type DockerGcSettings,
  type DockerGcState,
} from '../lib/api';
import {
  Alert,
  Badge,
  Button,
  HubGrid,
  HubIcon,
  HubTile,
  Input,
  Modal,
  Skeleton,
  Spinner,
  Switch,
  useToast,
} from './ui';

const TZ = 'Europe/Paris';

export function formatBytes(n: number | null | undefined): string {
  const v = Number(n || 0);
  if (v < 1000) return `${v} o`;
  const units = ['ko', 'Mo', 'Go', 'To'];
  let x = v;
  let i = -1;
  while (x >= 1000 && i < units.length - 1) {
    x /= 1000;
    i += 1;
  }
  return `${x.toLocaleString('fr-FR', { maximumFractionDigits: x < 10 ? 1 : 0 })} ${units[i]}`;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      timeZone: TZ,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Manuel',
  schedule: 'Planifié',
  emergency: 'Urgence disque',
};

type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';

const PILL: Record<Tone, string> = {
  ok: 'bg-emerald-500 text-zinc-950',
  warn: 'bg-amber-500 text-zinc-950',
  danger: 'bg-red-500 text-white',
  accent: 'bg-[var(--color-accent)] text-black',
  neutral: 'bg-white/20 text-white',
};

const TEXT: Record<Tone, string> = {
  ok: 'text-[var(--color-ok)]',
  warn: 'text-[var(--color-warn)]',
  danger: 'text-[var(--color-danger)]',
  accent: 'text-[var(--color-accent)]',
  neutral: 'text-[var(--color-ink-muted)]',
};

function status(label: string, tone: Tone, detail?: string) {
  return {
    badge: (
      <span
        class={`absolute -right-1 -top-1 max-w-[4.5rem] truncate rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-2 ring-[#1c1c1e] ${PILL[tone]}`}
      >
        {label}
      </span>
    ),
    subtitle: detail ? (
      <div class={`mt-1 line-clamp-2 text-[11px] font-medium leading-snug ${TEXT[tone]}`}>
        {detail}
      </div>
    ) : undefined,
  };
}

function diskTone(pct: number, alert: number): Tone {
  if (pct >= alert) return 'danger';
  if (pct >= alert - 10) return 'warn';
  return 'ok';
}

function DiskBar({ pct, alert }: { pct: number; alert: number }) {
  const tone = diskTone(pct, alert);
  const color =
    tone === 'danger' ? 'bg-red-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div class="relative h-2 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
      <div class={`h-full ${color} transition-[width] duration-300`} style={{ width: `${Math.min(pct, 100)}%` }} />
      <div class="absolute inset-y-0 w-px bg-white/60" style={{ left: `${alert}%` }} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: ComponentChildren }) {
  return (
    <div class="flex items-start justify-between gap-3 border-b border-[var(--color-line)] py-2 text-sm last:border-0">
      <span class="text-[var(--color-ink-muted)]">{label}</span>
      <span class="min-w-0 break-words text-right text-[var(--color-ink)]">{value}</span>
    </div>
  );
}

const FREQUENCIES = [
  { h: 6, label: 'Toutes les 6 h' },
  { h: 12, label: 'Toutes les 12 h' },
  { h: 24, label: 'Chaque jour' },
  { h: 48, label: 'Tous les 2 jours' },
  { h: 168, label: 'Chaque semaine (lundi)' },
];

const SELECT_CLASS =
  'h-11 w-full min-w-0 cursor-pointer rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-ink)] outline-none transition-[border-color,box-shadow] duration-200 focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent-soft)] sm:text-sm lg:h-10';

type ModalKind = 'settings' | 'clean' | 'history' | 'logs' | { node: string } | null;

/**
 * Admin « Nettoyage Docker » : tuiles (statut + au plus un switch), détails et
 * actions dans des modales. Le nettoyage manuel passe par une simulation puis une
 * confirmation explicite.
 */
export function DockerGcPanel() {
  const toast = useToast();
  const [state, setState] = useState<DockerGcState | null>(null);
  const [nodes, setNodes] = useState<DockerGcNodeDisk[] | null>(null);
  const [alertPct, setAlertPct] = useState(85);
  const [runs, setRuns] = useState<DockerGcRun[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [busy, setBusy] = useState(false);

  async function loadState() {
    try {
      setState(await api.dockerGcGet());
    } catch (e) {
      const msg = String((e as Error).message || e);
      if (/admin|réservé|403/i.test(msg)) setDenied(true);
    }
  }
  async function loadNodes() {
    try {
      const r = await api.dockerGcNodes();
      setNodes(r.nodes);
      setAlertPct(r.alert_percent);
    } catch {
      setNodes([]);
    }
  }
  async function loadRuns() {
    try {
      setRuns((await api.dockerGcRuns(50)).runs);
    } catch {
      setRuns([]);
    }
  }

  useEffect(() => {
    void loadState();
    void loadNodes();
    void loadRuns();
    const t = setInterval(() => {
      void loadState();
      void loadRuns();
    }, 15000);
    return () => clearInterval(t);
  }, []);

  async function save(next: DockerGcSettings, okTitle = 'Réglages enregistrés') {
    setBusy(true);
    try {
      const r = await api.dockerGcSave(next);
      setState((s) => ({ ...(s as DockerGcState), ...r }));
      toast.push({ title: okTitle, tone: 'ok' });
      void loadState();
      return true;
    } catch (e) {
      toast.push({ title: 'Échec', detail: String((e as Error).message || e), tone: 'danger' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (denied) return <Alert tone="warn">Réservé à l’administrateur d’instance.</Alert>;
  if (!state) {
    return (
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Skeleton class="h-36" />
        <Skeleton class="h-36" />
        <Skeleton class="h-36" />
      </div>
    );
  }

  const s = state.settings;
  const auto = s.enabled
    ? status('On', 'ok', `Prochain : ${formatWhen(state.next_run_at)}`)
    : status('Off', 'warn', 'Désactivé');
  const last = state.last_run;
  const clean = state.running
    ? status('En cours', 'accent', 'Nettoyage en cours…')
    : last
      ? status(
          last.ok ? 'OK' : 'Erreur',
          last.ok ? 'ok' : 'warn',
          `${formatBytes(last.freed_bytes)} libérés · ${formatWhen(last.finished_at)}`,
        )
      : status('Prêt', 'neutral', 'Simulation avant suppression');
  const errorsRecent = (runs ?? []).slice(0, 10).filter((r) => !r.ok).length;
  const history = !runs
    ? undefined
    : runs.length === 0
      ? status('0', 'neutral', 'Aucun passage')
      : status(
          String(runs.length),
          errorsRecent ? 'warn' : 'ok',
          errorsRecent
            ? `${errorsRecent} en erreur récemment`
            : `${formatBytes(runs.reduce((a, r) => a + r.freed_bytes, 0))} libérés au total`,
        );
  const logs = state.log_rotation_active
    ? status('On', 'ok', `${s.log_max_size_mb} Mo × ${s.log_max_files}`)
    : status('Off', 'warn', 'Recommandé');

  const nodeModal = typeof modal === 'object' && modal ? nodes?.find((n) => n.node_id === modal.node) : null;

  return (
    <div class="space-y-4">
      <HubGrid>
        <HubTile
          index={0}
          title="Nettoyage automatique"
          icon={<HubIcon name="refresh" />}
          badge={auto.badge}
          subtitle={auto.subtitle}
          onClick={() => setModal('settings')}
          footer={
            <Switch
              checked={s.enabled}
              disabled={busy}
              label="Nettoyage automatique"
              onToggle={() =>
                void save(
                  { ...s, enabled: !s.enabled },
                  s.enabled ? 'Nettoyage automatique désactivé' : 'Nettoyage automatique activé',
                )
              }
            />
          }
        />
        <HubTile
          index={1}
          title="Nettoyer maintenant"
          icon={<HubIcon name="trash" />}
          badge={clean.badge}
          subtitle={clean.subtitle}
          onClick={() => setModal('clean')}
        />
        <HubTile
          index={2}
          title="Historique"
          icon={<HubIcon name="clock" />}
          badge={history?.badge}
          subtitle={history?.subtitle}
          onClick={() => {
            void loadRuns();
            setModal('history');
          }}
        />
        <HubTile
          index={3}
          title="Rotation des logs"
          icon={<HubIcon name="folder" />}
          badge={logs.badge}
          subtitle={logs.subtitle}
          onClick={() => setModal('logs')}
        />
        {nodes === null ? (
          <Skeleton class="h-36" />
        ) : (
          nodes.map((n, i) => {
            const pct = n.disk?.percent ?? 0;
            const st = n.ok
              ? status(
                  `${Math.round(pct)} %`,
                  diskTone(pct, alertPct),
                  `${formatBytes(n.disk?.avail_bytes)} libres`,
                )
              : status('KO', 'danger', n.error || 'Injoignable');
            return (
              <HubTile
                key={n.node_id}
                index={4 + i}
                title={n.name}
                icon={<HubIcon name="disk" />}
                badge={st.badge}
                subtitle={st.subtitle}
                onClick={() => setModal({ node: n.node_id })}
              />
            );
          })
        )}
      </HubGrid>

      <SettingsModal
        open={modal === 'settings'}
        settings={s}
        cron={state.cron_expression}
        busy={busy}
        onClose={() => setModal(null)}
        onSave={async (next) => {
          if (await save(next)) setModal(null);
        }}
      />
      <CleanModal
        open={modal === 'clean'}
        running={!!state.running}
        onClose={() => setModal(null)}
        onStarted={() => {
          setModal(null);
          void loadState();
          setTimeout(() => {
            void loadState();
            void loadRuns();
            void loadNodes();
          }, 5000);
        }}
      />
      <HistoryModal open={modal === 'history'} runs={runs} onClose={() => setModal(null)} />
      <LogsModal
        open={modal === 'logs'}
        settings={s}
        active={!!state.log_rotation_active}
        nodes={nodes ?? []}
        busy={busy}
        onClose={() => setModal(null)}
        onSave={async (next) => {
          if (await save(next)) setModal(null);
        }}
      />
      <Modal
        open={!!nodeModal}
        onClose={() => setModal(null)}
        title={nodeModal?.name || 'Nœud'}
        description="Disque de la racine Docker"
        size="sm"
      >
        {nodeModal?.ok && nodeModal.disk ? (
          <div class="space-y-3">
            <DiskBar pct={nodeModal.disk.percent} alert={alertPct} />
            <div>
              <Row label="Occupé" value={`${nodeModal.disk.percent} % (${formatBytes(nodeModal.disk.used_bytes)})`} />
              <Row label="Libre" value={formatBytes(nodeModal.disk.avail_bytes)} />
              <Row label="Total" value={formatBytes(nodeModal.disk.total_bytes)} />
              <Row label="Seuil d’urgence" value={`${alertPct} %`} />
              <Row label="Racine Docker" value={<code class="text-xs">{nodeModal.disk.root_dir || '—'}</code>} />
              <Row label="Docker" value={nodeModal.disk.docker_version || '—'} />
              <Row label="Driver de logs" value={nodeModal.disk.logging_driver || '—'} />
            </div>
            {nodeModal.disk.legacy_guard === 'present' && (
              <Alert tone="warn">
                Ancien cron <code class="text-xs">/etc/cron.d/devforge-disk-guard</code> détecté : il
                sera désactivé automatiquement (remplacé par ce nettoyage).
              </Alert>
            )}
            {nodeModal.disk.legacy_guard === 'container' && (
              <Alert tone="info">
                DevForge tourne en conteneur sur ce nœud : l’ancien cron{' '}
                <code class="text-xs">/etc/cron.d/devforge-disk-guard</code> de l’hôte n’est pas
                visible d’ici. S’il existe, supprime-le sur l’hôte.
              </Alert>
            )}
          </div>
        ) : (
          <Alert tone="danger">{nodeModal?.error || 'Nœud injoignable'}</Alert>
        )}
      </Modal>
    </div>
  );
}

function SettingsModal({
  open,
  settings,
  cron,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: DockerGcSettings;
  cron: string;
  busy: boolean;
  onClose: () => void;
  onSave: (s: DockerGcSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [useCron, setUseCron] = useState(!!settings.cron);
  useEffect(() => {
    if (open) {
      setDraft(settings);
      setUseCron(!!settings.cron);
    }
  }, [open]);

  const num = (k: keyof DockerGcSettings) => (e: Event) =>
    setDraft((d) => ({ ...d, [k]: Number((e.target as HTMLInputElement).value) }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nettoyage automatique"
      description={`Heure de Paris · cron actuel : ${cron}`}
      size="md"
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => onSave({ ...draft, cron: useCron ? draft.cron || '' : null })}
          >
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      }
    >
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-[var(--color-ink)]">Expression cron personnalisée</span>
          <Switch checked={useCron} label="Cron personnalisé" onToggle={() => setUseCron((v) => !v)} />
        </div>
        {useCron ? (
          <Input
            label="Cron (5 champs, heure de Paris)"
            value={draft.cron || ''}
            placeholder="0 3 * * *"
            hint="Au plus un passage par heure."
            onInput={(e) => setDraft((d) => ({ ...d, cron: (e.target as HTMLInputElement).value }))}
          />
        ) : (
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5 text-sm">
              <span class="font-medium text-[var(--color-ink)]">Fréquence</span>
              <select
                class={SELECT_CLASS}
                value={String(draft.frequency_hours)}
                onChange={num('frequency_hours')}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.h} value={String(f.h)}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <Input
              label="Heure (0–23)"
              type="number"
              min={0}
              max={23}
              value={String(draft.hour)}
              onInput={num('hour')}
            />
          </div>
        )}
        <div class="grid gap-3 sm:grid-cols-3">
          <Input
            label="Rétention (h)"
            type="number"
            min={1}
            max={720}
            value={String(draft.retention_hours)}
            hint="Cache de build et images inutilisées plus vieux que ça."
            onInput={num('retention_hours')}
          />
          <Input
            label="Images par projet"
            type="number"
            min={1}
            max={20}
            value={String(draft.keep_per_project)}
            hint="Gardées pour un rollback."
            onInput={num('keep_per_project')}
          />
          <Input
            label="Alerte disque (%)"
            type="number"
            min={50}
            max={99}
            value={String(draft.disk_alert_percent)}
            hint="Au-delà : nettoyage d’urgence du nœud."
            onInput={num('disk_alert_percent')}
          />
        </div>
        <Alert tone="info">
          Jamais touchés : volumes, conteneurs (même arrêtés) et leurs images, image du
          déploiement en cours. Une urgence vide aussi tout le cache de build inutilisé.
        </Alert>
      </div>
    </Modal>
  );
}

function CleanModal({
  open,
  running,
  onClose,
  onStarted,
}: {
  open: boolean;
  running: boolean;
  onClose: () => void;
  onStarted: () => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<DockerGcPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirm(false);
    setPreview(null);
    setError(null);
    setLoading(true);
    api
      .dockerGcPreview()
      .then(setPreview)
      .catch((e) => setError(String((e as Error).message || e)))
      .finally(() => setLoading(false));
  }, [open]);

  const total = (preview?.nodes ?? []).reduce((a, n) => a + (n.total_bytes ?? 0), 0);
  const count = (preview?.nodes ?? []).reduce((a, n) => a + (n.images?.length ?? 0), 0);

  async function run() {
    setBusy(true);
    try {
      await api.dockerGcRun();
      toast.push({ title: 'Nettoyage lancé', detail: 'Suivi dans l’historique', tone: 'ok' });
      onStarted();
    } catch (e) {
      toast.push({ title: 'Échec', detail: String((e as Error).message || e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={confirm ? 'Confirmer le nettoyage ?' : 'Nettoyer maintenant'}
      description={confirm ? undefined : 'Simulation : rien n’est supprimé tant que tu ne confirmes pas.'}
      size="lg"
      fullOnMobile
      footer={
        <div class="flex flex-wrap justify-end gap-2">
          {confirm ? (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>
                Retour
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void run()}>
                {busy ? 'Lancement…' : `Supprimer ~${formatBytes(total)}`}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Fermer
              </Button>
              <Button
                variant="danger"
                disabled={loading || running || !preview}
                onClick={() => setConfirm(true)}
              >
                {running ? 'Déjà en cours' : 'Nettoyer…'}
              </Button>
            </>
          )}
        </div>
      }
    >
      {confirm ? (
        <div class="space-y-3 text-sm text-[var(--color-ink-muted)]">
          <p>
            Sur {preview?.nodes.filter((n) => n.ok).length ?? 0} nœud(s) : {count} image(s) et le
            cache de build de plus de {preview?.retention_hours} h, soit environ{' '}
            <strong class="text-[var(--color-ink)]">{formatBytes(total)}</strong>.
          </p>
          <Alert tone="warn">
            Les builds suivants seront plus longs (cache vidé) et les images supprimées ne
            pourront plus servir de rollback. Volumes et conteneurs ne sont jamais touchés.
          </Alert>
        </div>
      ) : loading ? (
        <div class="flex items-center gap-2 py-6 text-sm text-[var(--color-ink-muted)]">
          <Spinner /> Inventaire des nœuds…
        </div>
      ) : error ? (
        <Alert tone="danger">{error}</Alert>
      ) : (
        <div class="space-y-4">
          <p class="text-sm text-[var(--color-ink-muted)]">
            Estimation : <strong class="text-[var(--color-ink)]">{formatBytes(total)}</strong>{' '}
            ({count} image(s) + cache de build). Gardé : {preview?.keep_per_project} image(s) par
            projet, rétention {preview?.retention_hours} h.
          </p>
          {(preview?.nodes ?? []).map((n) => (
            <div key={n.node_id} class="rounded-2xl bg-[var(--color-surface)] p-3 ring-1 ring-[var(--color-line)]">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-medium text-[var(--color-ink)]">{n.name}</span>
                {n.ok ? (
                  <Badge tone="accent">{formatBytes(n.total_bytes)}</Badge>
                ) : (
                  <Badge tone="danger">KO</Badge>
                )}
              </div>
              {!n.ok ? (
                <p class="mt-2 text-xs text-[var(--color-danger)]">{n.error}</p>
              ) : (
                <div class="mt-2 space-y-2 text-xs text-[var(--color-ink-muted)]">
                  <div>
                    Cache de build : {formatBytes(n.cache_bytes)}
                    {n.build_cache_total ? ` (total ${n.build_cache_total.size})` : ''}
                    {(n.cache ?? []).length > 0 &&
                      ` · ${(n.cache ?? []).map((c) => `${c.builder.replace('buildkit:', '')} ${formatBytes(c.bytes)}`).join(', ')}`}
                  </div>
                  <div>
                    Protégé : {n.kept_count} image(s) gardée(s), {n.containers_untouched}{' '}
                    conteneur(s) non touché(s).
                  </div>
                  {(n.images ?? []).length === 0 ? (
                    <div>Aucune image à supprimer.</div>
                  ) : (
                    <ul class="divide-y divide-[var(--color-line)]">
                      {(n.images ?? []).map((img) => (
                        <li key={img.id} class="flex items-start justify-between gap-3 py-1.5">
                          <div class="min-w-0">
                            <div class="break-all font-mono text-[11px] text-[var(--color-ink)]">
                              {img.refs.length ? img.refs.join(', ') : `<none> ${img.id}`}
                            </div>
                            <div>{img.reason}</div>
                          </div>
                          <span class="shrink-0">{formatBytes(img.size)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function HistoryModal({
  open,
  runs,
  onClose,
}: {
  open: boolean;
  runs: DockerGcRun[] | null;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Historique" description="50 derniers passages par nœud" size="lg" fullOnMobile>
      {!runs ? (
        <Skeleton class="h-32" />
      ) : runs.length === 0 ? (
        <p class="text-sm text-[var(--color-ink-muted)]">Aucun nettoyage pour l’instant.</p>
      ) : (
        <ul class="divide-y divide-[var(--color-line)]">
          {runs.map((r) => (
            <li key={r.id} class="py-2.5 text-sm">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-[var(--color-ink)]">
                  {formatWhen(r.finished_at)} · {r.node_name}
                </span>
                <div class="flex items-center gap-1.5">
                  <Badge tone={r.trigger === 'emergency' ? 'warn' : 'neutral'}>
                    {TRIGGER_LABEL[r.trigger] || r.trigger}
                  </Badge>
                  <Badge tone={r.ok ? 'ok' : 'danger'}>{r.ok ? 'OK' : 'Erreur'}</Badge>
                </div>
              </div>
              <div class="mt-1 text-xs text-[var(--color-ink-muted)]">
                {formatBytes(r.freed_bytes)} libérés · {r.images_removed} image(s) ·{' '}
                {(r.duration_ms / 1000).toFixed(1)} s
                {r.disk_percent_before != null && r.disk_percent_after != null
                  ? ` · disque ${r.disk_percent_before} % → ${r.disk_percent_after} %`
                  : ''}
              </div>
              {r.errors.length > 0 && (
                <ul class="mt-1 space-y-0.5 text-xs text-[var(--color-danger)]">
                  {r.errors.slice(0, 5).map((e, i) => (
                    <li key={i} class="break-words">
                      {e}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function LogsModal({
  open,
  settings,
  active,
  nodes,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: DockerGcSettings;
  active: boolean;
  nodes: DockerGcNodeDisk[];
  busy: boolean;
  onClose: () => void;
  onSave: (s: DockerGcSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => {
    if (open) setDraft(settings);
  }, [open]);
  const unsupported = nodes.filter((n) => n.ok && n.log_rotation_supported === false);
  const snippet = `{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "${draft.log_max_size_mb}m", "max-file": "${draft.log_max_files}" }\n}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rotation des logs"
      description="Conteneurs lancés par DevForge (appliqué au prochain déploiement)"
      size="md"
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => onSave(draft)}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      }
    >
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-medium text-[var(--color-ink)]">Limiter les logs</div>
            <div class="text-xs text-[var(--color-ink-muted)]">
              {active ? 'Actif' : 'Inactif'} · ajoute <code>--log-opt</code> au lancement
            </div>
          </div>
          <Switch
            checked={draft.log_rotation}
            label="Rotation des logs"
            onToggle={() => setDraft((d) => ({ ...d, log_rotation: !d.log_rotation }))}
          />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <Input
            label="Taille max (Mo)"
            type="number"
            min={1}
            max={1024}
            value={String(draft.log_max_size_mb)}
            onInput={(e) => setDraft((d) => ({ ...d, log_max_size_mb: Number((e.target as HTMLInputElement).value) }))}
          />
          <Input
            label="Fichiers gardés"
            type="number"
            min={1}
            max={20}
            value={String(draft.log_max_files)}
            onInput={(e) => setDraft((d) => ({ ...d, log_max_files: Number((e.target as HTMLInputElement).value) }))}
          />
        </div>
        {unsupported.length > 0 && (
          <Alert tone="warn">
            Driver de logs incompatible sur : {unsupported.map((n) => `${n.name} (${n.disk?.logging_driver})`).join(', ')}.
          </Alert>
        )}
        <details class="rounded-xl bg-[var(--color-surface)] p-3 text-xs text-[var(--color-ink-muted)] ring-1 ring-[var(--color-line)]">
          <summary class="cursor-pointer text-[var(--color-ink)]">
            Pour tous les conteneurs (optionnel, manuel)
          </summary>
          <p class="mt-2">
            DevForge ne modifie pas <code>/etc/docker/daemon.json</code>. Pour l’appliquer à tous les
            conteneurs de l’hôte, ajoute ceci puis redémarre Docker (les conteneurs existants
            gardent leur réglage jusqu’à leur recréation) :
          </p>
          <pre class="mt-2 overflow-x-auto rounded-lg bg-black/30 p-2 font-mono">{snippet}</pre>
        </details>
      </div>
    </Modal>
  );
}
