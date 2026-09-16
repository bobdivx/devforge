import { useEffect, useState } from 'preact/hooks';
import { api, type ClusterNodeMetrics } from '../lib/api';
import { AppShell } from './AppShell';
import { Alert, Badge, Button, Card, Input, Spinner } from './ui';

function pct(used?: number | null, total?: number | null): string {
  if (used == null || total == null || total <= 0) return '—';
  return `${Math.round((used / total) * 100)}%`;
}

export function WorkerNodePage() {
  const [name, setName] = useState('Nœud');
  const [leader, setLeader] = useState('');
  const [advertise, setAdvertise] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [metrics, setMetrics] = useState<ClusterNodeMetrics | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api.clusterLocal();
      setName(r.node_name || 'Nœud');
      setLeader(r.leader_url || '');
      setAdvertise(r.advertise_url || '');
      setNodeId(r.node_id || '');
      setMetrics(r.metrics ?? null);
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
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      active="node"
      title={name}
      description="Cette machine est un nœud du cluster. L’interface produit tourne sur le leader."
      actions={<Badge tone={error ? 'danger' : 'ok'}>{error ? 'Erreur' : 'Worker'}</Badge>}
    >
      {!ready ? (
        <p class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
          <Spinner /> Chargement du nœud…
        </p>
      ) : (
        <div class="space-y-5">
          {error && (
            <Alert tone="danger">{error}</Alert>
          )}
          {saved && (
            <Alert tone="ok">{saved}</Alert>
          )}

          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card padding="sm">
              <p class="text-xs text-[var(--color-ink-muted)]">CPU</p>
              <p class="text-lg font-semibold">
                {typeof metrics?.cpu_percent === 'number' ? `${Math.round(metrics.cpu_percent)}%` : '—'}
              </p>
            </Card>
            <Card padding="sm">
              <p class="text-xs text-[var(--color-ink-muted)]">RAM</p>
              <p class="text-lg font-semibold">{pct(metrics?.mem_used_bytes, metrics?.mem_total_bytes)}</p>
            </Card>
            <Card padding="sm">
              <p class="text-xs text-[var(--color-ink-muted)]">Disque</p>
              <p class="text-lg font-semibold">{pct(metrics?.disk_used_bytes, metrics?.disk_total_bytes)}</p>
            </Card>
            <Card padding="sm">
              <p class="text-xs text-[var(--color-ink-muted)]">Docker</p>
              <p class="text-lg font-semibold">
                {metrics?.docker_ok == null
                  ? '—'
                  : metrics.docker_ok
                    ? `${metrics.containers ?? 0} ctr`
                    : 'KO'}
              </p>
            </Card>
          </div>

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
              <Button type="submit" disabled={busy}>
                {busy ? <Spinner /> : null}
                Enregistrer les adresses
              </Button>
            </form>
            <p class="mt-4 font-mono text-xs text-[var(--color-ink-muted)]">ID {nodeId || '—'}</p>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
