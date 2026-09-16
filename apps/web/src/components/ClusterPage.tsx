import { useEffect, useState } from 'preact/hooks';
import { api, type ClusterInvite, type ClusterNode } from '../lib/api';
import { formatJoinCode } from '../lib/cluster-invite';
import { AppShell } from './AppShell';
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

function nodeIcon(n: ClusterNode) {
  if (n.role === 'leader') {
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

  async function load() {
    try {
      const [n, i] = await Promise.all([api.clusterNodes(), api.clusterInvites().catch(() => null)]);
      setNodes(n.nodes ?? []);
      setInvites(i?.invites ?? []);
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
    if (!selected) return;
    setRename(selected.name);
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

  async function saveName() {
    if (!selected || !rename.trim()) return;
    setBusy(true);
    try {
      const r = await api.clusterPatchNode(selected.id, { name: rename.trim() });
      toast.push({ title: 'Nom enregistré', tone: 'ok' });
      setSelected(r.node);
      await load();
    } catch (err) {
      toast.push({ title: 'Rename KO', detail: String(err), tone: 'danger' });
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

  const online = nodes.filter((n) => n.status === 'online' && !n.drained).length;
  const drainedN = nodes.filter((n) => n.drained).length;
  const others = nodes.filter((n) => n.id !== selected?.id);

  return (
    <AppShell
      active="cluster"
      title="Cluster"
      description="Inviter un nœud = un code à coller. SSH reste en option."
      actions={
        <Button size="sm" variant="secondary" disabled={busy} onClick={createInvite}>
          Inviter
        </Button>
      }
    >
      {error && (
        <Alert tone="danger" class="mb-4">
          {error}
        </Alert>
      )}

      <div class="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card padding="sm">
          <p class="text-xs text-[var(--color-ink-muted)]">Nœuds</p>
          <p class="text-lg font-semibold">{nodes.length}</p>
        </Card>
        <Card padding="sm">
          <p class="text-xs text-[var(--color-ink-muted)]">En ligne</p>
          <p class="text-lg font-semibold">{online}</p>
        </Card>
        <Card padding="sm">
          <p class="text-xs text-[var(--color-ink-muted)]">Drain</p>
          <p class="text-lg font-semibold">{drainedN}</p>
        </Card>
        <Card padding="sm">
          <p class="text-xs text-[var(--color-ink-muted)]">Apps</p>
          <p class="text-lg font-semibold">{nodes.reduce((a, n) => a + (n.project_count ?? 0), 0)}</p>
        </Card>
      </div>

      {loading ? (
        <p class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
          <Spinner /> Chargement des nœuds…
        </p>
      ) : (
        <HubGrid cols={4}>
          {nodes.map((n, i) => {
            const cpu = n.metrics?.cpu_percent;
            return (
              <HubTile
                key={n.id}
                index={i}
                title={n.name}
                icon={nodeIcon(n)}
                subtitle={
                  <span class="flex flex-col items-center gap-1">
                    <Badge tone={statusTone(n.status, n.drained)}>
                      {statusLabel(n.status, n.drained)}
                    </Badge>
                    <span class="text-[11px] text-[var(--color-ink-muted)]">
                      {n.role === 'leader' ? 'Leader' : n.os || 'Worker'}
                      {typeof cpu === 'number' ? ` · CPU ${Math.round(cpu)}%` : ''}
                      {n.project_count ? ` · ${n.project_count} app${n.project_count > 1 ? 's' : ''}` : ''}
                    </span>
                  </span>
                }
                onClick={() => setSelected(n)}
              />
            );
          })}
          <HubAddTile index={nodes.length} label="Inviter un nœud" onClick={createInvite} />
        </HubGrid>
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
        description="Colle ce code sur l’autre machine (premier écran → Rejoindre un cluster). L’URL et le token sont dedans."
        size="md"
      >
        {invite ? (
          <div class="space-y-3">
            <Input
              label="Code d’invitation"
              value={invite.code || formatJoinCode(invite.leader_url, invite.token)}
              readOnly
            />
            <p class="text-xs text-[var(--color-ink-muted)]">
              Expire le {new Date(invite.expires_at).toLocaleString()}
            </p>
            <Button
              type="button"
              class="w-full"
              onClick={() =>
                copyText('Code', invite.code || formatJoinCode(invite.leader_url, invite.token))
              }
            >
              Copier le code
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
            ? `${selected.role} · ${statusLabel(selected.status, selected.drained)} · vu ${ago(selected.last_seen_at)}`
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
                <p class="font-mono text-xs text-[var(--color-ink-muted)]">{selected.id}</p>
                <div class="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Nom"
                    value={rename}
                    onInput={(e) => setRename((e.target as HTMLInputElement).value)}
                  />
                  <div class="flex items-end">
                    <Button disabled={busy || rename.trim() === selected.name} onClick={saveName}>
                      Enregistrer
                    </Button>
                  </div>
                </div>
                {selected.advertise_url && <p>URL : {selected.advertise_url}</p>}
                {selected.ssh_host && (
                  <p>
                    SSH : {selected.ssh_user}@{selected.ssh_host}:{selected.ssh_port || 22}
                  </p>
                )}
                {(selected.os || selected.arch) && (
                  <p>
                    {selected.os} {selected.arch}
                  </p>
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
                  {selected.role !== 'leader' && (
                    <Button variant="secondary" disabled={busy} onClick={toggleDrain}>
                      {selected.drained ? 'Retirer le drain' : 'Drainer (plus de nouveaux jobs)'}
                    </Button>
                  )}
                  {selected.role === 'leader' && (
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
                  Réassigner change le <code>server_id</code>. Le prochain deploy ira sur la cible ; les
                  conteneurs déjà lancés restent sur la machine actuelle.
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
                          {n.name}
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

            {selected.role !== 'leader' && (
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
