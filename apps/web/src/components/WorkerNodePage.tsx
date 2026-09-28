import { useEffect, useState } from 'preact/hooks';
import { api, type ClusterLocal, type ClusterNodeMetrics, type WorkerWorkload } from '../lib/api';
import type { Bootstrap } from '../lib/auth';
import { AppShell } from './AppShell';
import { JoinClusterForm } from './JoinClusterForm';
import { Alert, Badge, Button, Card, Input, Spinner } from './ui';

function pct(used?: number | null, total?: number | null): string {
  if (used == null || total == null || total <= 0) return '—';
  return `${Math.round((used / total) * 100)}%`;
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

function sectionFromLocation(): 'node' | 'adresses' {
  if (typeof window === 'undefined') return 'node';
  return new URLSearchParams(window.location.search).get('tab') === 'adresses' ? 'adresses' : 'node';
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card padding="sm">
      <p class="text-xs text-[var(--color-ink-muted)]">{label}</p>
      <p class="text-lg font-semibold">{value}</p>
    </Card>
  );
}

function MetricsRow({ metrics }: { metrics: ClusterNodeMetrics | null }) {
  const docker =
    metrics?.docker_ok == null ? '—' : metrics.docker_ok ? `${metrics.containers ?? 0} ctr` : 'KO';
  return (
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Metric
        label="CPU"
        value={typeof metrics?.cpu_percent === 'number' ? `${Math.round(metrics.cpu_percent)}%` : '—'}
      />
      <Metric label="RAM" value={pct(metrics?.mem_used_bytes, metrics?.mem_total_bytes)} />
      <Metric label="Disque" value={pct(metrics?.disk_used_bytes, metrics?.disk_total_bytes)} />
      <Metric label="Docker" value={docker} />
    </div>
  );
}

function WorkloadList({ items }: { items: WorkerWorkload[] | undefined }) {
  if (items == null) {
    return (
      <p class="text-sm text-[var(--color-ink-muted)]">État des conteneurs indisponible.</p>
    );
  }
  if (items.length === 0) {
    return (
      <div class="rounded-xl border border-dashed border-[var(--color-line)] px-4 py-6 text-sm text-[var(--color-ink-muted)]">
        <p class="font-medium text-[var(--color-ink)]">Aucune charge sur cette machine</p>
        <p class="mt-1 leading-relaxed">
          Le leader décide où lancer les applications. Tant qu’il n’en place pas ici, ce nœud
          reste en attente — il ne choisit pas quoi exécuter.
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
  const section = sectionFromLocation();

  async function load() {
    try {
      const [r, b] = await Promise.all([
        api.clusterLocal(),
        api.bootstrap().catch(() => null),
      ]);
      setLocal(r);
      setBoot(b);
      setLeader(r.leader_url || '');
      setAdvertise(r.advertise_url || '');
      setError(null);
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
  const showAddresses = joined && section === 'adresses';
  const version = (local?.version || local?.metrics?.software_version || '').replace(/^v/, '');
  const checked = ago(local?.link?.checked_at);

  let title = 'Ce nœud';
  let description = 'Cette machine n’a pas encore rejoint de leader.';
  if (joined && showAddresses) {
    title = 'Adresses';
    description = 'Adresses utilisées pour rester en contact avec le leader.';
  } else if (joined) {
    title = name;
    description = 'Ce nœud a rejoint le cluster. Il exécute le travail confié par le leader.';
  }

  return (
    <AppShell
      active={joined ? (showAddresses ? 'adresses' : 'node') : 'node'}
      title={title}
      description={description}
      actions={
        joined ? (
          <Badge tone={error ? 'danger' : linkTone(local?.link?.state)}>
            {error ? 'Erreur' : linkLabel(local?.link?.state)}
          </Badge>
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
                Une fois le join accepté, cet écran devient la fiche du worker : leader, rôle,
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

          {joined && !showAddresses && (
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

              <div class="grid gap-3 sm:grid-cols-2">
                <Card padding="lg">
                  <p class="text-xs text-[var(--color-ink-muted)]">Leader</p>
                  {leaderUrl ? (
                    <>
                      <a
                        href={leaderUrl}
                        target="_blank"
                        rel="noreferrer"
                        class="mt-1 block break-all text-sm font-medium text-[var(--color-accent)] hover:underline"
                      >
                        {hostOf(leaderUrl)}
                      </a>
                      <div class="mt-3">
                        <Button href={leaderUrl} target="_blank" rel="noreferrer" variant="outline" size="sm">
                          Ouvrir le leader
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p class="mt-1 text-sm text-[var(--color-ink)]">Aucun leader enregistré.</p>
                      <a href="/app/node?tab=adresses" class="mt-2 inline-block text-sm text-[var(--color-accent)]">
                        Renseigner l’adresse
                      </a>
                    </>
                  )}
                </Card>
                <Card padding="lg">
                  <p class="text-xs text-[var(--color-ink-muted)]">Rôle</p>
                  <p class="mt-1 text-sm font-medium text-[var(--color-ink)]">Worker · calcul</p>
                  <p class="mt-2 text-sm text-[var(--color-ink-muted)]">
                    Cette machine exécute les conteneurs. Elle ne porte pas le panel, les comptes
                    ni les dépôts.
                  </p>
                </Card>
                <Card padding="lg">
                  <p class="text-xs text-[var(--color-ink-muted)]">Santé</p>
                  <p class="mt-1 text-sm font-medium text-[var(--color-ink)]">
                    {linkLabel(local?.link?.state)}
                    {checked ? ` · ${checked}` : ''}
                  </p>
                  <p class="mt-2 text-sm text-[var(--color-ink-muted)]">
                    Docker{' '}
                    {local?.metrics?.docker_ok == null
                      ? 'inconnu'
                      : local.metrics.docker_ok
                        ? 'disponible'
                        : 'indisponible'}
                    {version ? ` · v${version}` : ''}
                  </p>
                </Card>
                <Card padding="lg">
                  <p class="text-xs text-[var(--color-ink-muted)]">Machine</p>
                  <p class="mt-1 break-all text-sm font-medium text-[var(--color-ink)]">
                    {local?.hostname || '—'}
                  </p>
                  <p class="mt-2 font-mono text-xs text-[var(--color-ink-muted)]">
                    {(local?.os || '—') + ' · ' + (local?.arch || '—')}
                    <br />
                    ID {local?.node_id || '—'}
                  </p>
                </Card>
              </div>

              <MetricsRow metrics={local?.metrics ?? null} />
              {local?.metrics?.docker_ok === false && (
                <Alert tone="warn">
                  Docker ne répond pas. Tant qu’il est arrêté, ce nœud ne peut pas lancer les
                  applications que le leader lui confie.
                </Alert>
              )}

              <Card padding="lg">
                <h2 class="text-sm font-semibold text-[var(--color-ink)]">Ce que fait ce nœud</h2>
                <p class="mt-1 mb-4 text-sm text-[var(--color-ink-muted)]">
                  Conteneurs DevForge présents sur cette machine. Le placement vient du leader.
                </p>
                <WorkloadList items={local?.workloads} />
              </Card>

              <Alert tone="info">
                Depuis ce nœud tu peux suivre la santé, corriger les adresses et quitter le
                cluster. Tu ne crées pas d’apps, d’agents, de jetons ni de comptes ici — et les
                mises à jour de ce nœud partent du leader.
              </Alert>
            </>
          )}

          {showAddresses && (
            <>
              <Card padding="lg">
                <form class="space-y-3" onSubmit={save}>
                  <Input
                    label="URL du leader"
                    value={leader}
                    placeholder="https://"
                    onInput={(e) => setLeader((e.target as HTMLInputElement).value)}
                    hint="Adresse que ce nœud utilise pour joindre le leader."
                  />
                  <Input
                    label="URL de ce nœud"
                    value={advertise}
                    placeholder="https://"
                    onInput={(e) => setAdvertise((e.target as HTMLInputElement).value)}
                    hint="Adresse que le leader utilise pour joindre cette machine."
                  />
                  <Button type="submit" disabled={busy || resetting}>
                    {busy ? <Spinner /> : null}
                    Enregistrer les adresses
                  </Button>
                </form>
                <p class="mt-4 font-mono text-xs text-[var(--color-ink-muted)]">
                  ID {local?.node_id || '—'}
                </p>
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
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
