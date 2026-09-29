import { useEffect, useState } from 'preact/hooks';
import { api, type ClusterLocal, type ClusterNodeMetrics, type WorkerWorkload } from '../lib/api';
import type { Bootstrap } from '../lib/auth';
import { AppShell } from './AppShell';
import { JoinClusterForm } from './JoinClusterForm';
import { WorkerNodeUpdate } from './WorkerNodeUpdate';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  HubGrid,
  HubIcon,
  HubTile,
  Input,
  Modal,
  Spinner,
} from './ui';

type Section = 'node' | 'reglages';
type Panel = 'version' | 'leader' | 'sante' | 'machine' | 'charges';

type VersionSnap = {
  current: string;
  latest?: string | null;
  update_available: boolean;
  jobStatus?: string | null;
};

function pct(used?: number | null, total?: number | null): string {
  if (used == null || total == null || total <= 0) return '—';
  return `${Math.round((used / total) * 100)}%`;
}

function fmtBytes(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

function bytesPair(used?: number | null, total?: number | null): string {
  const p = pct(used, total);
  if (p === '—') return '—';
  return `${p} · ${fmtBytes(used)} / ${fmtBytes(total)}`;
}

function isJoined(r: ClusterLocal): boolean {
  if (typeof r.joined === 'boolean') return r.joined;
  return r.role === 'worker' && !!r.node_id && r.node_id !== 'default';
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function ago(iso?: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 10) return 'à l’instant';
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  return `il y a ${Math.round(m / 60)} h`;
}

function linkLabel(state?: string): string {
  if (state === 'ok') return 'Leader joignable';
  if (state === 'down') return 'Leader injoignable';
  return 'Contact en attente';
}

function linkTone(state?: string): 'ok' | 'warn' | 'danger' {
  if (state === 'ok') return 'ok';
  if (state === 'down') return 'danger';
  return 'warn';
}

function kindLabel(kind: string): string {
  if (kind === 'app') return 'Application';
  if (kind === 'preview') return 'Aperçu';
  if (kind === 'proxy') return 'Proxy';
  return 'Charge';
}

function stateLabel(state: string): string {
  switch (state.toLowerCase()) {
    case 'running':
      return 'en cours';
    case 'exited':
      return 'arrêté';
    case 'created':
      return 'créé';
    case 'paused':
      return 'en pause';
    case 'restarting':
      return 'redémarrage';
    default:
      return state || 'inconnu';
  }
}

function stateTone(state: string): 'ok' | 'warn' | 'neutral' {
  const s = state.toLowerCase();
  if (s === 'running') return 'ok';
  if (s === 'exited' || s === 'dead') return 'warn';
  return 'neutral';
}

function prettyVersion(v: string): string {
  const t = v.trim().replace(/^v/i, '');
  return t ? `v${t}` : '—';
}

function sectionFromLocation(): Section {
  if (typeof window === 'undefined') return 'node';
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (tab === 'reglages' || tab === 'adresses' || tab === 'settings') return 'reglages';
  return 'node';
}

function panelFromLocation(): Panel | null {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search).get('ouvrir');
  if (q === 'version' || q === 'leader' || q === 'sante' || q === 'machine' || q === 'charges') return q;
  return null;
}

function versionBadge(snap: VersionSnap | null): {
  tone: 'ok' | 'warn' | 'danger' | 'accent' | 'neutral';
  label: string;
} {
  const st = snap?.jobStatus;
  if (st === 'running' || st === 'restarting') return { tone: 'accent', label: 'En cours' };
  if (st === 'failed') return { tone: 'danger', label: 'Échec' };
  if (snap?.update_available) return { tone: 'warn', label: 'MAJ' };
  if (snap) return { tone: 'ok', label: 'À jour' };
  return { tone: 'neutral', label: 'Version' };
}

function WorkloadList({ items }: { items: WorkerWorkload[] | undefined }) {
  if (items == null) {
    return <p class="text-sm text-[var(--color-ink-muted)]">État des conteneurs indisponible.</p>;
  }
  if (items.length === 0) {
    return (
      <div class="rounded-xl border border-dashed border-[var(--color-line)] px-4 py-6 text-sm text-[var(--color-ink-muted)]">
        <p class="font-medium text-[var(--color-ink)]">Aucune charge sur cette machine</p>
        <p class="mt-1 leading-relaxed">
          Le leader décide où lancer les applications. Tant qu’il n’en place pas ici, ce nœud reste
          en attente — il ne choisit pas quoi exécuter.
        </p>
      </div>
    );
  }
  return (
    <ul class="divide-y divide-[var(--color-line)]">
      {items.map((item) => (
        <li key={item.name} class="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <div class="min-w-0">
            <p class="truncate font-mono text-sm text-[var(--color-ink)]">{item.name}</p>
            <p class="mt-0.5 text-xs text-[var(--color-ink-muted)]">
              {kindLabel(item.kind)}
              {item.status ? ` · ${item.status}` : ''}
            </p>
          </div>
          <Badge tone={stateTone(item.state)}>{stateLabel(item.state)}</Badge>
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div class="flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] py-2.5 last:border-b-0">
      <dt class="text-sm text-[var(--color-ink-muted)]">{label}</dt>
      <dd class="min-w-0 truncate text-right font-mono text-sm text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}

export function WorkerNodePage() {
  const [local, setLocal] = useState<ClusterLocal | null>(null);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [leader, setLeader] = useState('');
  const [advertise, setAdvertise] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [section, setSection] = useState<Section>(sectionFromLocation);
  const [panel, setPanel] = useState<Panel | null>(panelFromLocation);
  const [versionSnap, setVersionSnap] = useState<VersionSnap | null>(null);

  useEffect(() => {
    const sync = () => {
      setSection(sectionFromLocation());
      setPanel(panelFromLocation());
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  function go(next: Section) {
    const url = next === 'reglages' ? '/app/node?tab=reglages' : '/app/node';
    if (window.location.pathname + window.location.search !== url) {
      history.pushState(null, '', url);
    }
    setSection(next);
    setPanel(null);
  }

  async function load() {
    try {
      const [r, b] = await Promise.all([api.clusterLocal(), api.bootstrap().catch(() => null)]);
      setLocal(r);
      setBoot(b);
      setLeader(r.leader_url || '');
      setAdvertise(r.advertise_url || '');
      setError(null);
      const worker = isJoined(r) || b?.cluster?.role === 'worker';
      if (worker) {
        api
          .updateCheck()
          .then((u) => {
            setVersionSnap({
              current: u.data.current || '',
              latest: u.data.latest,
              update_available: !!u.data.update_available,
              jobStatus: u.job?.status ?? null,
            });
          })
          .catch(() => {});
      }
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    load();
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
  }, []);

  const joined = local
    ? isJoined(local)
    : boot?.cluster?.role === 'worker' || boot?.cluster?.joined === true;

  useEffect(() => {
    if (!ready || joined) return;
    const t = window.setInterval(() => {
      api
        .bootstrap()
        .then((b) => {
          if (b.cluster?.role === 'worker' || b.cluster?.joined) {
            window.location.assign('/app/node');
          }
        })
        .catch(() => {});
    }, 4000);
    return () => window.clearInterval(t);
  }, [ready, joined]);

  async function save(e: Event) {
    e.preventDefault();
    const leaderUrl = leader.trim().replace(/\/+$/, '');
    const nodeUrl = advertise.trim().replace(/\/+$/, '');
    if (leaderUrl && !/^https?:\/\//i.test(leaderUrl)) {
      setError('URL du leader invalide (http:// ou https://)');
      return;
    }
    if (nodeUrl && !/^https?:\/\//i.test(nodeUrl)) {
      setError('URL de ce nœud invalide (http:// ou https://)');
      return;
    }
    if (!leaderUrl && !nodeUrl) {
      setError('Indique au moins une URL à enregistrer');
      return;
    }
    setBusy(true);
    setSaved(null);
    setError(null);
    try {
      const r = await api.clusterPatchLocal({
        ...(leaderUrl ? { leader_url: leaderUrl } : {}),
        ...(nodeUrl ? { advertise_url: nodeUrl } : {}),
      });
      setLeader(r.leader_url || '');
      setAdvertise(r.advertise_url || '');
      setSaved('Adresses enregistrées');
      await load();
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  }

  async function resetWorker() {
    if (
      !confirm(
        'Réinitialiser ce nœud ? Il quitte le cluster, efface son identité worker, puis redémarre. Tu pourras rejoindre un cluster depuis l’onboarding. Les apps Docker déjà lancées sur cette machine ne sont pas arrêtées.',
      )
    ) {
      return;
    }
    setResetting(true);
    setError(null);
    setSaved(null);
    try {
      await api.clusterResetLocal();
      setSaved('Réinitialisation… le nœud redémarre.');
      window.setTimeout(() => {
        window.location.href = '/';
      }, 2500);
    } catch (err) {
      setError(String((err as Error).message || err));
      setResetting(false);
    }
  }

  const name = local?.node_name?.trim() || 'Nœud';
  const leaderUrl = (local?.leader_url || '').trim().replace(/\/+$/, '');
  const nodeUrl = (local?.advertise_url || '').trim().replace(/\/+$/, '');
  const showSettings = joined && section === 'reglages';
  const version = (versionSnap?.current || local?.version || local?.metrics?.software_version || '').replace(
    /^v/,
    '',
  );
  const shownVersion = prettyVersion(version);
  const vBadge = versionBadge(versionSnap);
  const checked = ago(local?.link?.checked_at);
  const metrics: ClusterNodeMetrics | null = local?.metrics ?? null;
  const cpu =
    typeof metrics?.cpu_percent === 'number' ? `${Math.round(metrics.cpu_percent)}%` : '—';
  const ram = pct(metrics?.mem_used_bytes, metrics?.mem_total_bytes);
  const disk = pct(metrics?.disk_used_bytes, metrics?.disk_total_bytes);
  const dockerLabel =
    metrics?.docker_ok == null ? 'Docker inconnu' : metrics.docker_ok ? 'Docker OK' : 'Docker KO';
  const workloads = local?.workloads;
  const workloadCount = workloads == null ? null : workloads.length;
  const workloadLine =
    workloadCount == null
      ? 'Indisponible'
      : workloadCount === 0
        ? 'Aucune charge'
        : `${workloadCount} conteneur${workloadCount > 1 ? 's' : ''}`;

  let title = 'Ce nœud';
  let description = 'Cette machine n’a pas encore rejoint de leader.';
  if (showSettings) {
    title = 'Paramètres';
    description = 'URL du leader et adresse que le leader utilise pour joindre cette machine.';
  } else if (joined) {
    title = name;
    description = 'Version, santé et charges de ce nœud. Les adresses se règlent dans Paramètres.';
  }

  return (
    <AppShell
      active={joined ? (showSettings ? 'reglages' : 'node') : 'node'}
      title={title}
      description={description}
      actions={
        joined ? (
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              title="Voir la version et mettre à jour"
              onClick={() => setPanel('version')}
            >
              <Badge tone={vBadge.tone === 'neutral' ? 'accent' : vBadge.tone}>
                {shownVersion === '—' ? 'Version' : shownVersion}
                {vBadge.label === 'MAJ' || vBadge.label === 'En cours' || vBadge.label === 'Échec'
                  ? ` · ${vBadge.label}`
                  : ''}
              </Badge>
            </button>
            <Badge tone={error ? 'danger' : linkTone(local?.link?.state)}>
              {error ? 'Erreur' : linkLabel(local?.link?.state)}
            </Badge>
          </div>
        ) : (
          <Badge tone="neutral">Autonome</Badge>
        )
      }
    >
      {!ready ? (
        <p class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
          <Spinner /> Chargement du nœud…
        </p>
      ) : (
        <div class="space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}
          {saved && <Alert tone="ok">{saved}</Alert>}

          {!joined && (
            <>
              <Alert tone="info">
                Une fois le join accepté, cet écran devient la fiche du worker : version, leader,
                santé et charge. Les apps, les agents et l’administration restent sur le leader.
              </Alert>
              {local?.metrics?.docker_ok === false && (
                <Alert tone="warn">
                  Docker ne répond pas. Un worker sans Docker ne peut pas exécuter d’applications.
                </Alert>
              )}
              {boot?.cluster_pending && (
                <Alert tone="info">
                  Un leader du réseau peut aussi adopter cette machine. La page bascule toute seule
                  dès que le join est enregistré.
                </Alert>
              )}
              <Card padding="lg">
                <h2 class="text-sm font-semibold text-[var(--color-ink)]">Rejoindre un leader</h2>
                <p class="mt-1 mb-4 text-sm text-[var(--color-ink-muted)]">
                  Colle le jeton copié sur le leader, puis l’adresse à laquelle cette machine peut
                  le joindre.
                </p>
                <JoinClusterForm
                  busy={busy}
                  context={{
                    instanceUrl: boot?.settings?.instance_url,
                    wildcardDomain: boot?.settings?.wildcard_domain,
                    dns: boot?.settings?.dns
                      ? {
                          provider: boot.settings.dns.provider || '',
                          configured: !!boot.settings.dns.configured,
                          zone: boot.settings.dns.zone || '',
                        }
                      : null,
                  }}
                  onCancel={() => {
                    window.location.href = '/app';
                  }}
                  onSubmit={async (body) => {
                    setBusy(true);
                    setError(null);
                    try {
                      await api.clusterJoinLocal(body);
                      window.location.assign('/app/node');
                    } catch (e) {
                      setError(String((e as Error).message || e));
                      setBusy(false);
                    }
                  }}
                />
              </Card>
            </>
          )}

          {joined && !showSettings && (
            <>
              {local?.link?.state === 'down' && (
                <Alert tone="danger">
                  Le leader ne répond pas
                  {local.link.detail ? ` — ${local.link.detail}` : ''}. Les conteneurs déjà lancés
                  restent en place. Les nouvelles décisions (apps, comptes, agents) se prennent sur
                  le leader, dès qu’il est de nouveau joignable.
                </Alert>
              )}
              {local?.link?.state === 'unknown' && (
                <Alert tone="warn">
                  Premier contact avec le leader pas encore confirmé. L’identité est enregistrée ;
                  la santé du lien se met à jour toute seule.
                </Alert>
              )}
              {metrics?.docker_ok === false && (
                <Alert tone="warn">
                  Docker ne répond pas. Tant qu’il est arrêté, ce nœud ne peut pas lancer les
                  applications que le leader lui confie.
                </Alert>
              )}

              <HubGrid cols={4}>
                <HubTile
                  index={0}
                  layout="auto"
                  title={shownVersion === '—' ? 'Version' : shownVersion}
                  icon={<HubIcon name="refresh" />}
                  class={versionSnap?.update_available ? 'ring-1 ring-amber-400/50' : undefined}
                  onClick={() => setPanel('version')}
                  subtitle={
                    <span class="mt-1 flex flex-col items-center gap-1">
                      <span class="sr-only" data-df-node-version>
                        {shownVersion}
                      </span>
                      <Badge tone={vBadge.tone}>{vBadge.label}</Badge>
                      <span class="max-w-full truncate text-[11px] text-[var(--color-ink-muted)]">
                        {versionSnap?.update_available && versionSnap.latest
                          ? `Publiée ${prettyVersion(versionSnap.latest)}`
                          : 'Mettre à jour'}
                      </span>
                    </span>
                  }
                />
                <HubTile
                  index={1}
                  layout="auto"
                  title={leaderUrl ? hostOf(leaderUrl) : 'Leader'}
                  icon={<HubIcon name="globe" />}
                  onClick={() => setPanel('leader')}
                  subtitle={
                    <span class="mt-1 flex flex-col items-center gap-1">
                      <Badge tone={linkTone(local?.link?.state)}>{linkLabel(local?.link?.state)}</Badge>
                      <span class="max-w-full truncate text-[11px] text-[var(--color-ink-muted)]">
                        {checked || 'Adresse du leader'}
                      </span>
                    </span>
                  }
                />
                <HubTile
                  index={2}
                  layout="auto"
                  title="Santé"
                  icon={<HubIcon name="heart" />}
                  onClick={() => setPanel('sante')}
                  subtitle={
                    <span class="mt-1 flex flex-col items-center gap-1">
                      <Badge tone={metrics?.docker_ok === false ? 'danger' : 'ok'}>{dockerLabel}</Badge>
                      <span class="max-w-full truncate text-[11px] text-[var(--color-ink-muted)]">
                        CPU {cpu} · RAM {ram}
                      </span>
                    </span>
                  }
                />
                <HubTile
                  index={3}
                  layout="auto"
                  title="Charges"
                  icon={<HubIcon name="folder" />}
                  onClick={() => setPanel('charges')}
                  subtitle={
                    <span class="mt-1 flex flex-col items-center gap-1">
                      <span class="text-[11px] text-[var(--color-ink-muted)]">{workloadLine}</span>
                      <span class="max-w-full truncate text-[11px] text-[var(--color-ink-muted)]">
                        Disque {disk}
                      </span>
                    </span>
                  }
                />
                <HubTile
                  index={4}
                  layout="auto"
                  title={local?.hostname || 'Machine'}
                  icon={<HubIcon name="server" />}
                  iconClass="bg-white/10 text-[var(--color-ink)]"
                  onClick={() => setPanel('machine')}
                  subtitle={
                    <span class="mt-1 flex flex-col items-center gap-1">
                      <span class="max-w-full truncate text-[11px] text-[var(--color-ink-muted)]">
                        {(local?.os || '—') + ' · ' + (local?.arch || '—')}
                      </span>
                      <span class="max-w-full truncate font-mono text-[10px] text-[var(--color-ink-faint)]">
                        {local?.node_id || '—'}
                      </span>
                    </span>
                  }
                />
                <HubTile
                  index={5}
                  layout="auto"
                  title="Paramètres"
                  description="URL du leader et de ce nœud"
                  icon={<HubIcon name="settings" />}
                  onClick={() => go('reglages')}
                />
              </HubGrid>
            </>
          )}

          {showSettings && (
            <div class="grid gap-4 lg:grid-cols-5">
              <div class="space-y-4 lg:col-span-3">
                <Card padding="lg">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                      <p class="text-xs text-[var(--color-ink-muted)]">Version de ce nœud</p>
                      <p class="mt-1 text-2xl font-semibold tracking-tight" data-df-node-version>
                        {shownVersion}
                      </p>
                      <p class="mt-1 text-sm text-[var(--color-ink-muted)]">
                        {versionSnap?.update_available && versionSnap.latest
                          ? `Version publiée ${prettyVersion(versionSnap.latest)}`
                          : vBadge.label === 'À jour'
                            ? 'Ce nœud est à jour.'
                            : 'Vérifie la version publiée et lance la mise à jour ici.'}
                      </p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <Badge tone={vBadge.tone}>{vBadge.label}</Badge>
                      <Button size="sm" onClick={() => setPanel('version')}>
                        Mettre à jour
                      </Button>
                    </div>
                  </div>
                </Card>

                <Card padding="none">
                  <div class="px-4 pt-4 sm:px-6 sm:pt-6">
                    <CardHeader
                      title="Adresses"
                      description="Ces deux URL doivent être joignables depuis l’autre machine."
                      action={
                        <Badge tone={linkTone(local?.link?.state)}>{linkLabel(local?.link?.state)}</Badge>
                      }
                    />
                  </div>
                  <form class="border-t border-[var(--color-line)]" onSubmit={save}>
                    <div class="grid gap-4 px-4 py-4 sm:px-6 md:grid-cols-2">
                      <Input
                        label="URL du leader"
                        value={leader}
                        placeholder="http://10.1.0.58:8000"
                        onInput={(e) => setLeader((e.target as HTMLInputElement).value)}
                        hint="Adresse que ce nœud utilise pour joindre le leader."
                      />
                      <Input
                        label="URL de ce nœud"
                        value={advertise}
                        placeholder="http://10.1.0.88:8000"
                        onInput={(e) => setAdvertise((e.target as HTMLInputElement).value)}
                        hint="Adresse que le leader utilise pour joindre cette machine."
                      />
                    </div>
                    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] px-4 py-4 sm:px-6">
                      <p class="font-mono text-xs text-[var(--color-ink-muted)]">
                        ID {local?.node_id || '—'}
                      </p>
                      <Button type="submit" disabled={busy || resetting}>
                        {busy ? <Spinner /> : null}
                        Enregistrer les adresses
                      </Button>
                    </div>
                  </form>
                </Card>
              </div>

              <div class="space-y-4 lg:col-span-2">
                <Card padding="lg">
                  <CardHeader title="Identité" description="Ce que le leader connaît de cette machine." />
                  <dl>
                    <Fact label="Nom" value={name} />
                    <Fact label="Hôte" value={local?.hostname || '—'} />
                    <Fact label="Système" value={`${local?.os || '—'} · ${local?.arch || '—'}`} />
                    <Fact label="ID" value={local?.node_id || '—'} />
                  </dl>
                </Card>

                <Card padding="lg">
                  <h2 class="text-sm font-semibold text-[var(--color-ink)]">Quitter le cluster</h2>
                  <p class="mt-1 text-sm text-[var(--color-ink-muted)]">
                    Efface l’identité worker et remet cette machine en instance neuve. Utile pour
                    rejoindre un autre leader. Les conteneurs déjà lancés ne sont pas arrêtés, et
                    cette action ne se fait pas depuis le panel du leader.
                  </p>
                  <div class="mt-4">
                    <Button variant="danger" disabled={busy || resetting} onClick={resetWorker}>
                      {resetting ? <Spinner /> : null}
                      Réinitialiser le worker
                    </Button>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {joined && (
            <>
              <Modal
                open={panel === 'version'}
                onClose={() => setPanel(null)}
                title="Version de ce nœud"
                description="Vérifie la version publiée et mets cette machine à jour."
                size="md"
              >
                {panel === 'version' ? (
                  <WorkerNodeUpdate versionHint={version} embedded />
                ) : null}
              </Modal>

              <Modal
                open={panel === 'leader'}
                onClose={() => setPanel(null)}
                title="Leader"
                description="Adresse que ce nœud utilise pour joindre le leader."
                size="md"
              >
                <p class="break-all font-mono text-sm text-[var(--color-ink)]">{leaderUrl || '—'}</p>
                <p class="mt-2 text-sm text-[var(--color-ink-muted)]">
                  {linkLabel(local?.link?.state)}
                  {checked ? ` · ${checked}` : ''}
                </p>
                {local?.link?.detail ? (
                  <p class="mt-1 text-sm text-[var(--color-ink-muted)]">{local.link.detail}</p>
                ) : null}
                <div class="mt-4 flex flex-wrap gap-2">
                  {leaderUrl ? (
                    <Button href={leaderUrl} target="_blank" rel="noreferrer">
                      Ouvrir le leader
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPanel(null);
                      go('reglages');
                    }}
                  >
                    Modifier les adresses
                  </Button>
                </div>
              </Modal>

              <Modal
                open={panel === 'sante'}
                onClose={() => setPanel(null)}
                title="Santé"
                description="Charge de cette machine et état de Docker."
                size="md"
              >
                <div class="grid grid-cols-2 gap-3">
                  <div class="rounded-xl bg-white/5 px-3 py-3">
                    <p class="text-xs text-[var(--color-ink-muted)]">CPU</p>
                    <p class="mt-1 text-lg font-semibold">{cpu}</p>
                  </div>
                  <div class="rounded-xl bg-white/5 px-3 py-3">
                    <p class="text-xs text-[var(--color-ink-muted)]">RAM</p>
                    <p class="mt-1 text-lg font-semibold">{ram}</p>
                    <p class="text-xs text-[var(--color-ink-muted)]">
                      {bytesPair(metrics?.mem_used_bytes, metrics?.mem_total_bytes)}
                    </p>
                  </div>
                  <div class="rounded-xl bg-white/5 px-3 py-3">
                    <p class="text-xs text-[var(--color-ink-muted)]">Disque</p>
                    <p class="mt-1 text-lg font-semibold">{disk}</p>
                    <p class="text-xs text-[var(--color-ink-muted)]">
                      {bytesPair(metrics?.disk_used_bytes, metrics?.disk_total_bytes)}
                    </p>
                  </div>
                  <div class="rounded-xl bg-white/5 px-3 py-3">
                    <p class="text-xs text-[var(--color-ink-muted)]">Docker</p>
                    <p class="mt-1 text-lg font-semibold">{dockerLabel}</p>
                    <p class="text-xs text-[var(--color-ink-muted)]">
                      {metrics?.containers == null ? '—' : `${metrics.containers} conteneurs`}
                    </p>
                  </div>
                </div>
              </Modal>

              <Modal
                open={panel === 'machine'}
                onClose={() => setPanel(null)}
                title="Machine"
                description="Identité locale de ce nœud."
                size="md"
              >
                <dl>
                  <Fact label="Nom" value={name} />
                  <Fact label="Hôte" value={local?.hostname || '—'} />
                  <Fact label="Système" value={`${local?.os || '—'} · ${local?.arch || '—'}`} />
                  <Fact label="ID" value={local?.node_id || '—'} />
                  <Fact label="Annoncée" value={nodeUrl ? hostOf(nodeUrl) : '—'} />
                </dl>
                <div class="mt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPanel(null);
                      go('reglages');
                    }}
                  >
                    Paramètres des adresses
                  </Button>
                </div>
              </Modal>

              <Modal
                open={panel === 'charges'}
                onClose={() => setPanel(null)}
                title="Charges"
                description="Conteneurs DevForge présents sur cette machine. Le placement vient du leader."
                size="md"
              >
                <WorkloadList items={workloads} />
              </Modal>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
