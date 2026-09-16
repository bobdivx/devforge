import { useEffect, useState } from 'preact/hooks';
import { api, type ClusterNodeMetrics } from '../lib/api';
import { Badge, Card, FadeIn, Spinner } from './ui';

function pct(used?: number | null, total?: number | null): string {
  if (used == null || total == null || total <= 0) return '—';
  return `${Math.round((used / total) * 100)}%`;
}

export function WorkerNodePage() {
  const [name, setName] = useState('Nœud');
  const [leader, setLeader] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [metrics, setMetrics] = useState<ClusterNodeMetrics | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api.clusterLocal();
      setName(r.node_name || 'Nœud');
      setLeader(r.leader_url || '');
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

  if (!ready) {
    return (
      <div class="flex min-h-screen items-center justify-center gap-3 text-sm text-[var(--color-ink-muted)]">
        <Spinner />
      </div>
    );
  }

  return (
    <div class="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
      <FadeIn>
        <Card padding="lg">
          <div class="mb-4 flex items-center justify-between gap-3">
            <h1 class="text-xl font-semibold tracking-tight">{name}</h1>
            <Badge tone={error ? 'danger' : 'ok'}>{error ? 'Erreur' : 'Worker'}</Badge>
          </div>
          <p class="text-sm leading-relaxed text-[var(--color-ink-muted)]">
            Cette machine est un nœud du cluster. L’interface produit tourne sur le leader.
          </p>
          <dl class="mt-5 space-y-2 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-[var(--color-ink-muted)]">Leader</dt>
              <dd class="truncate font-mono text-xs">{leader || '—'}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-[var(--color-ink-muted)]">ID</dt>
              <dd class="truncate font-mono text-xs">{nodeId || '—'}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-[var(--color-ink-muted)]">CPU</dt>
              <dd>
                {typeof metrics?.cpu_percent === 'number' ? `${Math.round(metrics.cpu_percent)}%` : '—'}
              </dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-[var(--color-ink-muted)]">RAM</dt>
              <dd>{pct(metrics?.mem_used_bytes, metrics?.mem_total_bytes)}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-[var(--color-ink-muted)]">Disque</dt>
              <dd>{pct(metrics?.disk_used_bytes, metrics?.disk_total_bytes)}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-[var(--color-ink-muted)]">Docker</dt>
              <dd>
                {metrics?.docker_ok == null
                  ? '—'
                  : metrics.docker_ok
                    ? `ok · ${metrics.containers ?? 0} ctr`
                    : 'KO'}
              </dd>
            </div>
          </dl>
          {error && <p class="mt-4 text-sm text-[var(--color-danger)]">{error}</p>}
        </Card>
      </FadeIn>
    </div>
  );
}
