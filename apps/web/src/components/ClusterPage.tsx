import { useEffect, useState } from 'preact/hooks';
import { api, type ClusterInvite, type ClusterNode, type Project } from '../lib/api';
import { nodeRoleLabel, resolveNode } from '../lib/cluster-display';
import { projectStatusMeta } from '../lib/status';
import { AppShell } from './AppShell';
import { InstanceAdminGate } from './InstanceAdminGate';
import {
  Alert,
  Badge,
  Button,
  Card,
  FadeIn,
  HubAddTile,
  HubGrid,
  HubTile,
  Input,
  Modal,
  Spinner,
  Table,
  Td,
  ToastProvider,
  Tr,
  useToast,
} from './ui';

type Tab = 'info' | 'apps' | 'diag';

function statusTone(s: string, drained?: boolean): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (drained) return 'warn';
  if (s === 'online') return 'ok';
  if (s === 'joining') return 'warn';
  if (s === 'offline') return 'danger';
  return 'neutral';
}

function statusLabel(s: string, drained?: boolean): string {
  if (drained) return 'Drain';
  if (s === 'online') return 'En ligne';
  if (s === 'joining') return 'Enrôlement…';
  if (s === 'offline') return 'Hors ligne';
  return s;
}

function nodeVersion(n: ClusterNode): string {
  const v = n.metrics?.software_version?.trim();
  return v ? v.replace(/^v/, '') : '';
}

function parseVer(s: string): [number, number, number] {
  const p = s.replace(/^v/, '').split(/[.-]/);
  return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
}

function verGt(a: string, b: string): boolean {
  const pa = parseVer(a);
  const pb = parseVer(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

function nodeBehind(n: ClusterNode, latest?: string | null): boolean {
  const cur = nodeVersion(n);
  const lat = latest?.replace(/^v/, '') ?? '';
  if (!cur || !lat) return false;
  return verGt(lat, cur);
}

function isLeader(n: ClusterNode) {
  return n.role === 'leader' || n.id === 'default';
}

function roleLabel(n: ClusterNode) {
  return isLeader(n) ? 'Leader' : 'Worker';
}

function nodeIcon(n: ClusterNode) {
  if (isLeader(n)) {
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden>
        <path d="M12 3 4 8v8l8 5 8-5V8l-8-5z" stroke-linejoin="round" />
        <path d="M12 12 4 8M12 12l8-4M12 12v13" />
      </svg>
    );
  }
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 7h.01M7 17h.01" stroke-linecap="round" />
    </svg>
  );
}

function NodeHubCard({
  n,
  index,
  latest,
  interim,
  onOpen,
}: {
  n: ClusterNode;
  index: number;
  latest?: string | null;
  interim?: boolean;
  onOpen: (n: ClusterNode) => void;
}) {
  const leader = isLeader(n);
  const cpu = n.metrics?.cpu_percent;
  const ver = nodeVersion(n);
  const behind = nodeBehind(n, latest);
  const badgeText = interim ? 'Intérim' : leader ? 'Leader' : 'Worker';
  return (
    <HubTile
      index={index}
      title={n.name}
      icon={nodeIcon(n)}
      class={leader || interim ? 'ring-1 ring-[var(--color-accent)]/45' : undefined}
      iconClass={leader || interim ? undefined : 'bg-white/10 text-[var(--color-ink)]'}
      badge={
        <span
          class={
            leader || interim
              ? 'absolute -bottom-1 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-black'
              : 'absolute -bottom-1 rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white'
          }
        >
          {badgeText}
        </span>
      }
      subtitle={
        <span class="mt-1 flex flex-col items-center gap-1">
          <Badge tone={statusTone(n.status, n.drained)}>
            {statusLabel(n.status, n.drained)}
          </Badge>
          <span class="text-[11px] text-[var(--color-ink-muted)]">
            {interim ? 'Control plane intérimaire' : leader ? 'Control plane' : 'Compute'}
            {ver ? ` · v${ver}` : ''}
            {typeof cpu === 'number' ? ` · CPU ${Math.round(cpu)}%` : ''}
            {n.project_count
              ? ` · ${n.project_count} app${n.project_count > 1 ? 's' : ''}`
              : ''}
          </span>
          {behind ? (
            <Badge tone="warn">MAJ</Badge>
          ) : null}
          {n.advertise_url ? (
            <span class="max-w-full truncate font-mono text-[10px] text-[var(--color-ink-muted)]">
              {n.advertise_url.replace(/^https?:\/\//, '')}
            </span>
          ) : null}
          {!leader && n.advertise_ok === false ? (
            <Badge tone="danger">URL loopback</Badge>
          ) : null}
          {!leader && n.ingress_ready === false ? (
            <Badge tone="warn">Ingress</Badge>
          ) : null}
        </span>
      }
      onClick={() => onOpen(n)}
    />
  );
}

function ago(iso?: string | null): string {
  if (!iso) return 'jamais';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 15) return 'à l’instant';
  if (sec < 60) return `il y a ${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 36) return `il y a ${h} h`;
  return new Date(t).toLocaleString();
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

function pct(used?: number | null, total?: number | null): number | null {
  if (used == null || total == null || total <= 0) return null;
  return Math.round((used / total) * 100);
}

function inviteState(inv: ClusterInvite): { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' } {
  if (inv.revoked_at) return { label: 'Révoquée', tone: 'neutral' };
  const exp = Date.parse(inv.expires_at);
  if (Number.isFinite(exp) && exp < Date.now()) return { label: 'Expirée', tone: 'danger' };
  return { label: 'Active', tone: 'ok' };
}

export function ClusterPage() {
  return (
    <InstanceAdminGate active="cluster" title="Cluster">
      <ClusterPageInner />
    </InstanceAdminGate>
  );
}

function ClusterPageInner() {
  return (
    <ToastProvider>
      <ClusterInner />
    </ToastProvider>
  );
}

function ClusterInner() {
  const toast = useToast();
  const [nodes, setNodes] = useState<ClusterNode[]>([]);
  const [invites, setInvites] = useState<ClusterInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [user, setUser] = useState('root');
  const [port, setPort] = useState('22');

  const [selected, setSelected] = useState<ClusterNode | null>(null);
  const [tab, setTab] = useState<Tab>('info');
  const [rename, setRename] = useState('');
  const [nodeUrl, setNodeUrl] = useState('');
  const [ingressHost, setIngressHost] = useState('');
  const [projects, setProjects] = useState<
    Array<{ uuid: string; name: string; status: string; server_id: string }>
  >([]);
  const [targetId, setTargetId] = useState('default');
  const [logs, setLogs] = useState<string | null>(null);
  const [logsBusy, setLogsBusy] = useState(false);
  const [invite, setInvite] = useState<{
    token: string;
    leader_url: string;
    code?: string;
    expires_at: string;
  } | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [updating, setUpdating] = useState<Record<string, string>>({});
  const [forges, setForges] = useState<Project[]>([]);
  const [actingLeader, setActingLeader] = useState(false);
  const [actingNodeId, setActingNodeId] = useState('');
  const [placementAuto, setPlacementAuto] = useState(true);
  const [rebalanceBusy, setRebalanceBusy] = useState(false);
  const [dnsProvider, setDnsProvider] = useState('');
  const [dnsConfigured, setDnsConfigured] = useState(false);

  async function load() {
    try {
      const [n, i, chk, p, boot] = await Promise.all([
        api.clusterNodes(),
        api.clusterInvites().catch(() => null),
        api.updateCheck().catch(() => null),
        api.projects().catch(() => null),
        api.bootstrap().catch(() => null),
      ]);
      if (boot?.settings?.dns) {
        setDnsProvider(boot.settings.dns.provider || '');
        setDnsConfigured(!!boot.settings.dns.configured);
      }
      setNodes(n.nodes ?? []);
      setActingLeader(!!n.acting_leader);
      setActingNodeId(n.acting_node_id ?? '');
      if (typeof n.placement_auto === 'boolean') setPlacementAuto(n.placement_auto);
      setInvites(i?.invites ?? []);
      setForges(p?.data ?? []);
      if (chk?.data?.latest) setLatest(chk.data.latest.replace(/^v/, ''));
      const lat = chk?.data?.latest?.replace(/^v/, '') || latest;
      setUpdating((cur) => {
        const next = { ...cur };
        for (const id of Object.keys(next)) {
          const node = (n.nodes ?? []).find((x) => x.id === id);
          if (node && lat && !nodeBehind(node, lat) && node.status === 'online') {
            delete next[id];
          }
        }
        return next;
      });
      setError(null);
      setSelected((cur) => {
        if (!cur) return cur;
        return (n.nodes ?? []).find((x) => x.id === cur.id) ?? cur;
      });
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = window.setInterval(load, 8000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!Object.keys(updating).length) return;
    const t = window.setInterval(load, 4000);
    return () => window.clearInterval(t);
  }, [Object.keys(updating).join(',')]);

  useEffect(() => {
    if (!selected) return;
    setRename(selected.name);
    setNodeUrl(selected.advertise_url || '');
    setIngressHost(selected.ingress_host || '');
    setTab('info');
    setLogs(null);
    setTargetId(nodes.find((n) => n.id !== selected.id && !n.drained)?.id || 'default');
    api
      .clusterNodeProjects(selected.id)
      .then((r) => setProjects(r.projects ?? []))
      .catch(() => setProjects([]));
  }, [selected?.id]);

  async function submitAdd(e: Event) {
    e.preventDefault();
    if (!host.trim()) return;
    setBusy(true);
    try {
      await api.clusterAddNode({
        name: name.trim() || host.trim(),
        host: host.trim(),
        user: user.trim() || 'root',
        port: Number(port) || 22,
      });
      toast.push({ title: 'Nœud ajouté', detail: 'Bootstrap SSH lancé', tone: 'ok' });
      setAddOpen(false);
      setName('');
      setHost('');
      await load();
    } catch (err) {
      toast.push({ title: 'Ajout KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function createInvite() {
    setBusy(true);
    try {
      const b = await api.bootstrap();
      const leaderUrl = (b.settings.instance_url || '').trim() || window.location.origin;
      const r = await api.clusterCreateInvite({ leader_url: leaderUrl });
      setInvite(r.invite);
      setInviteOpen(true);
      await load();
    } catch (err) {
      toast.push({ title: 'Invitation KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.push({ title: `${label} copié`, tone: 'ok' });
    } catch {
      toast.push({ title: 'Copie impossible', detail: value, tone: 'warn' });
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await api.clusterRevokeInvite(id);
      toast.push({ title: 'Invitation révoquée', tone: 'ok' });
      await load();
    } catch (err) {
      toast.push({ title: 'Révocation KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function saveInfo() {
    if (!selected) return;
    const name = rename.trim();
    const url = nodeUrl.trim().replace(/\/+$/, '');
    const host = ingressHost.trim().replace(/\/+$/, '');
    if (!name) return;
    if (url && !/^https?:\/\//i.test(url)) {
      toast.push({ title: 'URL invalide', detail: 'http:// ou https://', tone: 'danger' });
      return;
    }
    setBusy(true);
    try {
      const body: { name?: string; advertise_url?: string; ingress_host?: string } = {};
      if (name !== selected.name) body.name = name;
      if (url && url !== (selected.advertise_url || '')) body.advertise_url = url;
      if (host !== (selected.ingress_host || '')) body.ingress_host = host;
      if (!body.name && !body.advertise_url && body.ingress_host === undefined) {
        toast.push({ title: 'Rien à enregistrer', tone: 'info' });
        return;
      }
      const r = await api.clusterPatchNode(selected.id, body);
      toast.push({ title: 'Enregistré', tone: 'ok' });
      setSelected(r.node);
      await load();
    } catch (err) {
      toast.push({ title: 'Enregistrement KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function toggleDrain() {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api.clusterPatchNode(selected.id, { drained: !selected.drained });
      toast.push({
        title: r.node.drained ? 'Drain activé' : 'Drain retiré',
        detail: r.node.drained
          ? 'Plus de nouveaux jobs sur ce nœud.'
          : 'Le nœud reprend les déploiements.',
        tone: 'ok',
      });
      setSelected(r.node);
      await load();
    } catch (err) {
      toast.push({ title: 'Drain KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function migrate(projectUuid?: string, all = false) {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api.clusterReassign(selected.id, {
        target_node_id: targetId,
        project_uuid: projectUuid,
        all,
      });
      toast.push({
        title: 'Réassigné',
        detail: r.hint,
        tone: 'ok',
      });
      const p = await api.clusterNodeProjects(selected.id);
      setProjects(p.projects ?? []);
      await load();
    } catch (err) {
      toast.push({ title: 'Migration KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function fetchLogs() {
    if (!selected) return;
    setLogsBusy(true);
    try {
      const r = await api.clusterNodeLogs(selected.id);
      setLogs(r.output || '(vide)');
    } catch (err) {
      setLogs(String(err));
    } finally {
      setLogsBusy(false);
    }
  }

  async function updateNode(n: ClusterNode) {
    setBusy(true);
    try {
      const r = await api.clusterNodeUpdateStart(
        n.id,
        latest ? { target_version: latest } : undefined,
      );
      if (r.skipped) {
        toast.push({ title: 'Déjà à jour', detail: r.message || n.name, tone: 'ok' });
      } else {
        const target = r.target_version || latest || '';
        setUpdating((cur) => ({ ...cur, [n.id]: `Mise à jour vers ${target}…` }));
        toast.push({
          title: 'Mise à jour lancée',
          detail: `${n.name} → ${target}. Les apps Docker de ce nœud restent en place.`,
          tone: 'ok',
        });
      }
      await load();
    } catch (err) {
      toast.push({ title: 'Mise à jour KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function updateAllWorkers() {
    setBusy(true);
    try {
      const r = await api.clusterUpdateWorkers(latest ? { target_version: latest } : undefined);
      const failed = r.results.filter((x) => !x.ok);
      const started = r.results.filter((x) => x.ok && !x.skipped);
      const next: Record<string, string> = {};
      for (const x of started) next[x.id] = `Mise à jour vers ${r.target_version}…`;
      if (Object.keys(next).length) {
        setUpdating((cur) => ({ ...cur, ...next }));
      }
      toast.push({
        title: failed.length ? 'MAJ partielle' : 'Workers',
        detail: failed.length
          ? failed.map((x) => `${x.name}: ${x.error}`).join(' · ')
          : started.length
            ? `${started.length} nœud(s) vers ${r.target_version}`
            : 'Tous les workers sont déjà à jour.',
        tone: failed.length ? 'danger' : 'ok',
      });
      await load();
    } catch (err) {
      toast.push({ title: 'Mise à jour KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(n: ClusterNode) {
    if (n.role === 'leader') return;
    const count = n.project_count ?? 0;
    const dest = nodes.find((x) => x.id !== n.id && !x.drained)?.id || 'default';
    const ok = window.confirm(
      count > 0
        ? `Retirer « ${n.name} » et déplacer ${count} projet(s) vers ${dest} ?`
        : `Retirer le nœud « ${n.name} » ?`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.clusterRemoveNode(n.id, count > 0 ? dest : undefined);
      toast.push({ title: 'Nœud retiré', detail: n.name, tone: 'ok' });
      setSelected(null);
      await load();
    } catch (err) {
      toast.push({ title: 'Suppression KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function togglePlacementAuto() {
    const next = !placementAuto;
    setBusy(true);
    try {
      const r = await api.clusterPatchSettings({ placement_auto: next });
      setPlacementAuto(!!r.placement_auto);
      toast.push({
        title: r.placement_auto ? 'Placement auto ON' : 'Placement auto OFF',
        detail: r.placement_auto
          ? 'Les nouveaux projets / deploys choisissent le meilleur nœud.'
          : 'Les nouveaux projets vont sur le leader.',
        tone: 'ok',
      });
    } catch (err) {
      toast.push({ title: 'Réglage KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function runRebalance(apply: boolean) {
    setRebalanceBusy(true);
    try {
      const r = await api.clusterRebalance({ apply });
      const n = r.suggestions?.length ?? 0;
      if (!apply) {
        if (!n) {
          toast.push({
            title: 'Déjà équilibré',
            detail: 'Aucune suggestion de déplacement.',
            tone: 'ok',
          });
        } else {
          const ok = window.confirm(
            `${n} forge(s) seraient déplacées. Appliquer le rebalance ?\n\n` +
              (r.suggestions || [])
                .slice(0, 8)
                .map((s) => `• ${s.name}: ${s.from} → ${s.to}`)
                .join('\n') +
              (n > 8 ? `\n… +${n - 8}` : ''),
          );
          if (ok) await runRebalance(true);
        }
        return;
      }
      toast.push({
        title: 'Rebalance appliqué',
        detail: `${r.moved} projet(s) réassignés — redeploy pour lancer sur la cible.`,
        tone: 'ok',
      });
      await load();
    } catch (err) {
      toast.push({ title: 'Rebalance KO', detail: String(err), tone: 'danger' });
    } finally {
      setRebalanceBusy(false);
    }
  }

  const leaderNode = nodes.find(isLeader) ?? null;
  const workers = nodes.filter((n) => !isLeader(n));
  const actingNode = nodes.find((x) => x.id === actingNodeId) ?? null;
  const online = nodes.filter((n) => n.status === 'online' && !n.drained).length;
  const others = nodes.filter((n) => n.id !== selected?.id);
  const workersBehind = workers.filter(
    (n) => n.status === 'online' && nodeBehind(n, latest),
  );

  return (
    <AppShell
      active="cluster"
      title="Cluster"
      description="Un leader (control plane) et des workers (compute). Les apps Docker restent sur leur machine."
      actions={
        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={togglePlacementAuto}
            title="Placement automatique des forges"
          >
            Placement {placementAuto ? 'auto' : 'manuel'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || rebalanceBusy}
            onClick={() => runRebalance(false)}
          >
            Rebalance
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={createInvite}>
            Inviter
          </Button>
        </div>
      }
    >
      {error && (
        <Alert tone="danger" class="mb-4">
          {error}
        </Alert>
      )}

      {actingLeader && (
        <Alert tone="warn" class="mb-5">
          <p class="font-medium text-[var(--color-ink)]">Leader intérimaire</p>
          <p class="mt-1 text-[var(--color-ink-muted)]">
            Le leader d’origine est injoignable.{' '}
            {actingNode?.name ? `« ${actingNode.name} »` : 'Un worker'} sert le panel avec la
            dernière copie SQLite (retard ~30–60 s). Au retour du leader d’origine, les écritures
            de l’intérim sont reprises.
          </p>
        </Alert>
      )}

      <Alert tone="info" class="mb-5">
        <p class="font-medium text-[var(--color-ink)]">Placement, pas de réplica d’apps</p>
        <ul class="mt-2 list-disc space-y-1 pl-4 text-[var(--color-ink-muted)]">
          <li>
            Chaque forge tourne sur <strong class="text-[var(--color-ink)]">un seul nœud</strong>{' '}
            (leader ou worker). Il n’y a pas de copie automatique des conteneurs.
          </li>
          <li>
            <strong class="text-[var(--color-ink)]">Placement auto</strong>{' '}
            {placementAuto ? 'ON' : 'OFF'} — créations / deploys sans nœud fixe choisissent le
            meilleur worker sain (pénalité leader si workers dispo). Rebalance pour répartir.
          </li>
          <li>
            <strong class="text-[var(--color-ink)]">Leader</strong> — UI, API, SQLite. Les workers
            gardent une copie récente. S’il tombe : un worker est élu jusqu’au retour (perte max
            ~1 min). Un tunnel Cloudflare seulement sur le leader reste un SPOF DNS — un tunnel
            par nœud + placement corrige ça (Phase 2).
          </li>
          <li>
            <strong class="text-[var(--color-ink)]">Worker</strong> — compute. URL d’annonce
            saisie manuellement (domaine si Cloudflare / Porkbun, sinon IP LAN — pas 127.0.0.1).
            S’il tombe : seules les forges de <em>ce</em> nœud
            s’arrêtent.
          </li>
        </ul>
      </Alert>

      <div class="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card padding="sm">
          <p class="text-xs text-[var(--color-ink-muted)]">Leader</p>
          <p class="text-lg font-semibold">{leaderNode ? 1 : 0}</p>
        </Card>
        <Card padding="sm">
          <p class="text-xs text-[var(--color-ink-muted)]">Workers</p>
          <p class="text-lg font-semibold">{workers.length}</p>
        </Card>
        <Card padding="sm">
          <p class="text-xs text-[var(--color-ink-muted)]">En ligne</p>
          <p class="text-lg font-semibold">{online}</p>
        </Card>
        <Card padding="sm">
          <p class="text-xs text-[var(--color-ink-muted)]">Forges</p>
          <p class="text-lg font-semibold">{forges.length}</p>
        </Card>
      </div>

      {loading ? (
        <p class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
          <Spinner /> Chargement des nœuds…
        </p>
      ) : (
        <div class="space-y-8">
          <section>
            <h2 class="mb-3 text-sm font-medium">Control plane</h2>
            <HubGrid cols={4}>
              {leaderNode ? (
                <NodeHubCard
                  n={leaderNode}
                  index={0}
                  latest={latest}
                  interim={actingLeader && leaderNode.id === actingNodeId}
                  onOpen={setSelected}
                />
              ) : (
                <p class="col-span-full text-sm text-[var(--color-ink-muted)]">
                  Aucun leader enregistré.
                </p>
              )}
            </HubGrid>
          </section>
          <section>
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-sm font-medium">Workers</h2>
              {workersBehind.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={updateAllWorkers}
                >
                  Mettre à jour {workersBehind.length} worker
                  {workersBehind.length > 1 ? 's' : ''}
                </Button>
              )}
            </div>
            <HubGrid cols={4}>
              {workers.map((n, i) => (
                <NodeHubCard
                  key={n.id}
                  n={n}
                  index={i + 1}
                  latest={latest}
                  interim={actingLeader && n.id === actingNodeId}
                  onOpen={setSelected}
                />
              ))}
              <HubAddTile
                index={workers.length + 1}
                label="Inviter un worker"
                onClick={createInvite}
              />
            </HubGrid>
            {workers.length === 0 && (
              <p class="mt-3 text-sm text-[var(--color-ink-muted)]">
                Aucun worker. Les forges tournent sur le leader jusqu’à ce que tu enrôles une machine.
              </p>
            )}
          </section>
        </div>
      )}

      {!loading && (
      <div class="mt-8">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-sm font-medium">Forges</h2>
          <p class="text-xs text-[var(--color-ink-muted)]">
            {forges.length} projet{forges.length > 1 ? 's' : ''} · un nœud par forge
          </p>
        </div>
        {forges.length === 0 ? (
          <p class="text-sm text-[var(--color-ink-muted)]">
            Aucune forge. Elles apparaîtront ici avec le nœud qui les héberge.
          </p>
        ) : (
          <Table headers={['Forge', 'Nœud', 'Rôle', 'Statut app', 'Statut nœud']}>
            {forges.map((p) => {
              const host = resolveNode(nodes, p.server_id);
              const offline = host.status === 'offline' || host.status === 'joining';
              const st = projectStatusMeta(p.status);
              return (
                <Tr key={p.uuid}>
                  <Td>
                    <a
                      class="font-medium hover:underline"
                      href={`/app/projects/view?uuid=${encodeURIComponent(p.uuid)}`}
                    >
                      {p.name}
                    </a>
                  </Td>
                  <Td>
                    <button
                      type="button"
                      class="text-left hover:underline"
                      onClick={() => {
                        const full = nodes.find((n) => n.id === host.id);
                        if (full) setSelected(full);
                      }}
                    >
                      {host.name}
                    </button>
                  </Td>
                  <Td>{nodeRoleLabel(host)}</Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={offline ? 'danger' : host.drained ? 'warn' : 'ok'}>
                      {host.drained ? 'Drain' : host.status === 'online' ? 'En ligne' : host.status}
                    </Badge>
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </div>
      )}

      <div class="mt-8">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-sm font-medium">Invitations</h2>
          <div class="flex items-center gap-3">
            <Button size="sm" variant="secondary" disabled={busy} onClick={createInvite}>
              Nouvelle
            </Button>
            <button
              type="button"
              class="text-xs text-[var(--color-ink-muted)] hover:underline"
              onClick={() => setAddOpen(true)}
            >
              SSH
            </button>
          </div>
        </div>
        {invites.length === 0 ? (
          <p class="text-sm text-[var(--color-ink-muted)]">
            Aucune invitation. Clique <strong>Inviter un nœud</strong> : tu copies un code, tu le colles
            sur l’autre machine.
          </p>
        ) : (
          <Table headers={['ID', 'Créée', 'Expire', 'État', 'Actions']}>
            {invites.map((inv) => {
              const st = inviteState(inv);
              return (
                <Tr key={inv.id}>
                  <Td class="font-mono text-xs">{inv.id}</Td>
                  <Td>{ago(inv.created_at)}</Td>
                  <Td>{new Date(inv.expires_at).toLocaleString()}</Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </Td>
                  <Td>
                    {st.label === 'Active' && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => revoke(inv.id)}>
                        Révoquer
                      </Button>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Enrôler via SSH"
        description="Optionnel. Le chemin simple, c’est une invitation (code unique) collée sur l’autre machine."
        size="md"
      >
        <form class="space-y-3" onSubmit={submitAdd}>
          <Input
            label="Nom"
            value={name}
            placeholder="zimacube"
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Hôte / IP"
            value={host}
            required
            placeholder="10.1.0.58"
            onInput={(e) => setHost((e.target as HTMLInputElement).value)}
          />
          <div class="grid grid-cols-2 gap-3">
            <Input
              label="User SSH"
              value={user}
              onInput={(e) => setUser((e.target as HTMLInputElement).value)}
            />
            <Input
              label="Port"
              type="number"
              value={port}
              onInput={(e) => setPort((e.target as HTMLInputElement).value)}
            />
          </div>
          <p class="text-xs text-[var(--color-ink-muted)]">
            La clé SSH de Settings → Serveur est utilisée. Docker doit être présent sur la machine
            distante.
          </p>
          <Button type="submit" class="w-full" disabled={busy || !host.trim()}>
            {busy ? <Spinner /> : null}
            Enrôler
          </Button>
        </form>
      </Modal>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invitation"
        description="Copie le jeton sur l’autre machine. L’URL du leader se renseigne à part (celle que le nœud peut joindre)."
        size="md"
      >
        {invite ? (
          <div class="space-y-3">
            <Input
              label="Jeton"
              value={invite.token}
              readOnly
            />
            <Input
              label="URL de cette instance"
              value={invite.leader_url}
              readOnly
              hint="À coller comme URL du leader si le nœud l’atteint ainsi. Modifiable de l’autre côté."
            />
            <p class="text-xs text-[var(--color-ink-muted)]">
              Expire le {new Date(invite.expires_at).toLocaleString()}
            </p>
            <Button
              type="button"
              class="w-full"
              onClick={() => copyText('Jeton', invite.token)}
            >
              Copier le jeton
            </Button>
            <button
              type="button"
              class="w-full text-center text-sm text-[var(--color-ink-muted)] hover:underline"
              onClick={() => {
                setInviteOpen(false);
                setAddOpen(true);
              }}
            >
              Avancé : enrôler via SSH
            </button>
          </div>
        ) : (
          <FadeIn>
            <Spinner />
          </FadeIn>
        )}
      </Modal>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? 'Nœud'}
        description={
          selected
            ? `${roleLabel(selected)} · ${isLeader(selected) ? 'control plane' : 'compute'} · ${statusLabel(selected.status, selected.drained)} · vu ${ago(selected.last_seen_at)}`
            : undefined
        }
        size="xl"
      >
        {selected && (
          <div class="space-y-4">
            <div class="flex flex-wrap gap-2">
              {(['info', 'apps', 'diag'] as Tab[]).map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={tab === t ? 'secondary' : 'ghost'}
                  onClick={() => setTab(t)}
                >
                  {t === 'info' ? 'Infos' : t === 'apps' ? 'Apps' : 'Diagnostic'}
                </Button>
              ))}
            </div>

            {tab === 'info' && (
              <div class="space-y-3 text-sm">
                <Alert tone={isLeader(selected) ? 'info' : 'ok'}>
                  {isLeader(selected)
                    ? 'Control plane : UI, API, SQLite. Les forges ciblées ici tournent sur cette machine. Pas de copie automatique vers les workers.'
                    : 'Worker (compute) : les forges ciblées ici s’exécutent sur cette machine uniquement. S’il plante, réassigne puis redéploie.'}
                </Alert>
                <p class="font-mono text-xs text-[var(--color-ink-muted)]">{selected.id}</p>
                <div class="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Nom"
                    value={rename}
                    onInput={(e) => setRename((e.target as HTMLInputElement).value)}
                  />
                  <Input
                    label={isLeader(selected) ? 'URL du leader' : 'URL du nœud'}
                    value={nodeUrl}
                    placeholder="https://"
                    onInput={(e) => setNodeUrl((e.target as HTMLInputElement).value)}
                    hint={
                      isLeader(selected)
                        ? 'Adresse que les workers utilisent pour joindre ce leader.'
                        : selected.advertise_hint ||
                          (dnsConfigured && dnsProvider === 'cloudflare'
                            ? 'Cloudflare actif : hostname / domaine public (pas l’IP machine auto). Saisie manuelle.'
                            : dnsConfigured && dnsProvider === 'porkbun'
                              ? 'Porkbun actif : hostname public ou IP joignable — pas 127.0.0.1. Saisie manuelle.'
                              : 'IP LAN ou hostname joignable depuis le leader (pas 127.0.0.1). Saisie manuelle.')
                    }
                  />
                  <Input
                    label="Cible publique (auto)"
                    value={ingressHost}
                    placeholder="rempli par DevForge"
                    onInput={(e) => setIngressHost((e.target as HTMLInputElement).value)}
                    hint={
                      dnsConfigured && dnsProvider === 'cloudflare'
                        ? 'Cloudflare : *.cfargotunnel.com (resync DNS). Surcharge manuelle possible.'
                        : dnsConfigured && dnsProvider === 'porkbun'
                          ? 'Porkbun : IP publique détectée (resync DNS). Surcharge manuelle possible.'
                          : 'Sans DNS : laisse vide ou saisis une cible. Cloudflare / Porkbun remplissent via resync.'
                    }
                  />
                </div>
                <Button
                  disabled={
                    busy ||
                    (!rename.trim() ||
                      (rename.trim() === selected.name &&
                        nodeUrl.trim().replace(/\/+$/, '') === (selected.advertise_url || '') &&
                        ingressHost.trim() === (selected.ingress_host || '')))
                  }
                  onClick={saveInfo}
                >
                  Enregistrer
                </Button>
                {selected.ssh_host && (
                  <p>
                    SSH : {selected.ssh_user}@{selected.ssh_host}:{selected.ssh_port || 22}
                  </p>
                )}
                {(selected.os || selected.arch || nodeVersion(selected)) && (
                  <p>
                    {selected.os} {selected.arch}
                    {nodeVersion(selected)
                      ? ` · DevForge v${nodeVersion(selected)}`
                      : ''}
                    {latest && nodeBehind(selected, latest) ? ` (cible v${latest})` : ''}
                  </p>
                )}
                {updating[selected.id] && (
                  <Alert tone="info">
                    {updating[selected.id]} Les apps déjà lancées sur ce nœud ne sont pas
                    recréées.
                  </Alert>
                )}
                <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric label="CPU" value={
                    typeof selected.metrics?.cpu_percent === 'number'
                      ? `${Math.round(selected.metrics.cpu_percent)}%`
                      : '—'
                  } />
                  <Metric
                    label="RAM"
                    value={
                      pct(selected.metrics?.mem_used_bytes, selected.metrics?.mem_total_bytes) != null
                        ? `${pct(selected.metrics?.mem_used_bytes, selected.metrics?.mem_total_bytes)}% · ${fmtBytes(selected.metrics?.mem_used_bytes)}`
                        : '—'
                    }
                  />
                  <Metric
                    label="Disque"
                    value={
                      pct(selected.metrics?.disk_used_bytes, selected.metrics?.disk_total_bytes) != null
                        ? `${pct(selected.metrics?.disk_used_bytes, selected.metrics?.disk_total_bytes)}% · ${fmtBytes(selected.metrics?.disk_used_bytes)}`
                        : '—'
                    }
                  />
                  <Metric
                    label="Docker"
                    value={
                      selected.metrics?.docker_ok == null
                        ? '—'
                        : selected.metrics.docker_ok
                          ? `ok · ${selected.metrics.containers ?? 0} ctr`
                          : 'KO'
                    }
                  />
                </div>
                {selected.last_error && <Alert tone="danger">{selected.last_error}</Alert>}
                <div class="flex flex-wrap gap-2">
                  {!isLeader(selected) && (
                    <Button
                      disabled={
                        busy ||
                        selected.status !== 'online' ||
                        !selected.advertise_url ||
                        !!updating[selected.id]
                      }
                      onClick={() => updateNode(selected)}
                    >
                      {updating[selected.id]
                        ? 'Mise à jour…'
                        : nodeBehind(selected, latest)
                          ? `Mettre à jour vers ${latest}`
                          : 'Mettre à jour ce nœud'}
                    </Button>
                  )}
                  {!isLeader(selected) && (
                    <Button variant="secondary" disabled={busy} onClick={toggleDrain}>
                      {selected.drained ? 'Retirer le drain' : 'Drainer (plus de nouveaux jobs)'}
                    </Button>
                  )}
                  {isLeader(selected) && (
                    <Button
                      variant="outline"
                      onClick={() => (window.location.href = '/app/settings?tab=update')}
                    >
                      {nodeBehind(selected, latest)
                        ? `Mettre à jour le leader (${latest})`
                        : 'Mise à jour du leader'}
                    </Button>
                  )}
                  {isLeader(selected) && (
                    <Button variant="outline" onClick={() => (window.location.href = '/app/settings?tab=backup')}>
                      Sauvegarde leader
                    </Button>
                  )}
                </div>
              </div>
            )}

            {tab === 'apps' && (
              <div class="space-y-3">
                <p class="text-xs text-[var(--color-ink-muted)]">
                  Réassigner change le nœud du <em>prochain</em> deploy. Les conteneurs déjà lancés
                  restent sur la machine actuelle — ce n’est pas une réplication.
                </p>
                {others.length > 0 && (
                  <label class="block text-sm">
                    <span class="mb-1 block text-[var(--color-ink-muted)]">Nœud cible</span>
                    <select
                      class="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] px-3 py-2"
                      value={targetId}
                      onChange={(e) => setTargetId((e.target as HTMLSelectElement).value)}
                    >
                      {others.map((n) => (
                        <option key={n.id} value={n.id} disabled={n.drained}>
                          {roleLabel(n)} · {n.name}
                          {n.drained ? ' (drain)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {projects.length === 0 ? (
                  <p class="text-sm text-[var(--color-ink-muted)]">Aucune app sur ce nœud.</p>
                ) : (
                  <Table headers={['App', 'Statut', '']}>
                    {projects.map((p) => (
                      <Tr key={p.uuid}>
                        <Td>
                          <a class="hover:underline" href={`/app/projects/view?uuid=${encodeURIComponent(p.uuid)}`}>
                            {p.name}
                          </a>
                        </Td>
                        <Td>{p.status}</Td>
                        <Td>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || others.length === 0}
                            onClick={() => migrate(p.uuid)}
                          >
                            Déplacer
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </Table>
                )}
                {projects.length > 0 && others.length > 0 && (
                  <Button variant="outline" disabled={busy} onClick={() => migrate(undefined, true)}>
                    Tout déplacer vers la cible
                  </Button>
                )}
              </div>
            )}

            {tab === 'diag' && (
              <div class="space-y-3">
                <Button disabled={logsBusy} onClick={fetchLogs}>
                  {logsBusy ? <Spinner /> : null}
                  Capturer uptime / disque / docker
                </Button>
                {logs && (
                  <pre class="max-h-80 overflow-auto rounded-xl bg-black/40 p-3 font-mono text-xs whitespace-pre-wrap">
                    {logs}
                  </pre>
                )}
              </div>
            )}

            {!isLeader(selected) && (
              <Button
                variant="danger"
                class="w-full"
                disabled={busy}
                onClick={() => {
                  const n = selected;
                  remove(n);
                }}
              >
                Retirer ce nœud
              </Button>
            )}
          </div>
        )}
      </Modal>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card padding="sm">
      <p class="text-[11px] text-[var(--color-ink-muted)]">{label}</p>
      <p class="truncate text-sm font-medium">{value}</p>
    </Card>
  );
}
