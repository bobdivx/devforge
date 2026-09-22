import { useEffect, useState } from 'preact/hooks';
import { api, type AppGroup, type Project } from '../lib/api';
import { projectStatusMeta } from '../lib/status';
import { AppShell } from './AppShell';
import { Alert, Button, Card, CardHeader, FadeIn, Input, Spinner } from './ui';
import { useToast } from './ui/Toast';

const ROLE_HINTS = ['web', 'client', 'server', 'api'];

export function GroupPage() {
  const uuid = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('uuid') || '';
  return (
    <AppShell active="home" title="Groupe">
      <GroupBody uuid={uuid} />
    </AppShell>
  );
}

function GroupBody({ uuid }: { uuid: string }) {
  const toast = useToast();
  const [group, setGroup] = useState<AppGroup | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addProject, setAddProject] = useState('');
  const [addRole, setAddRole] = useState('server');

  async function load() {
    if (!uuid) {
      setError('Groupe manquant.');
      setLoading(false);
      return;
    }
    try {
      const [g, p] = await Promise.all([api.group(uuid), api.projects()]);
      setGroup(g.data);
      setName(g.data.name);
      setProjects(p.data);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [uuid]);

  async function rename(e: Event) {
    e.preventDefault();
    if (!group) return;
    setBusy(true);
    try {
      const r = await api.updateGroup(group.uuid, { name: name.trim() });
      setGroup(r.data);
      toast.push({ title: 'Groupe renommé', tone: 'ok' });
    } catch (err) {
      toast.push({ title: 'Renommage KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function addMember(e: Event) {
    e.preventDefault();
    if (!group || !addProject) return;
    setBusy(true);
    try {
      const r = await api.addGroupMember(group.uuid, {
        project_uuid: addProject,
        role: addRole.trim(),
      });
      setGroup(r.data);
      setAddProject('');
      toast.push({ title: 'App reliée', detail: 'Redéploie pour appliquer le réseau et les variables.', tone: 'ok' });
    } catch (err) {
      toast.push({ title: 'Ajout KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function saveRole(projectUuid: string, role: string) {
    if (!group) return;
    setBusy(true);
    try {
      const r = await api.updateGroupMember(group.uuid, projectUuid, { role });
      setGroup(r.data);
      toast.push({ title: 'Rôle enregistré', detail: 'Redéploie les apps du groupe.', tone: 'ok' });
    } catch (err) {
      toast.push({ title: 'Rôle KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function saveGpu(projectUuid: string, gpu_nvidia: boolean, gpu_dri: boolean) {
    setBusy(true);
    try {
      await api.updateProject(projectUuid, { gpu_nvidia, gpu_dri });
      await load();
      toast.push({ title: 'GPU enregistré', detail: 'Appliqué au prochain déploiement.', tone: 'ok' });
    } catch (err) {
      toast.push({ title: 'GPU KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(projectUuid: string) {
    if (!group) return;
    setBusy(true);
    try {
      const r = await api.removeGroupMember(group.uuid, projectUuid);
      setGroup(r.data);
    } catch (err) {
      toast.push({ title: 'Retrait KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup() {
    if (!group) return;
    setBusy(true);
    try {
      await api.deleteGroup(group.uuid);
      window.location.href = '/app';
    } catch (err) {
      toast.push({ title: 'Suppression KO', detail: String(err), tone: 'danger' });
      setBusy(false);
    }
  }

  const candidates = projects.filter((p) => !p.group_uuid);

  return (
    <>
      {loading && (
        <p class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
          <Spinner /> Chargement…
        </p>
      )}
      {error && <Alert tone="warn">{error}</Alert>}
      {group && (
        <FadeIn>
          <div class="space-y-4">
            <Card>
              <CardHeader
                title="Groupe"
                description={`Réseau ${group.network}. Les apps partagent ce réseau et reçoivent DF_GROUP, DF_ROLE, DF_{ROLE}_URL au déploiement. Même nœud pour tout le groupe.`}
              />
              <form class="flex flex-wrap items-end gap-3" onSubmit={rename}>
                <div class="min-w-[16rem] flex-1">
                  <Input label="Nom" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
                </div>
                <Button type="submit" disabled={busy || !name.trim()}>
                  Renommer
                </Button>
              </form>
            </Card>

            <Card>
              <CardHeader title="Apps" description="Un rôle unique par app. L'alias Docker est le rôle (http://server:8080)." />
              <ul class="divide-y divide-[var(--color-line)]">
                {group.members.map((m) => (
                  <MemberRow
                    key={m.project_uuid}
                    member={m}
                    busy={busy}
                    onRole={(role) => saveRole(m.project_uuid, role)}
                    onGpu={(nvidia, dri) => saveGpu(m.project_uuid, nvidia, dri)}
                    onRemove={() => remove(m.project_uuid)}
                  />
                ))}
                {group.members.length === 0 && (
                  <li class="py-3 text-sm text-[var(--color-ink-muted)]">Aucune app dans ce groupe.</li>
                )}
              </ul>
            </Card>

            <Card>
              <CardHeader title="Ajouter une app" description="Projets qui ne sont pas déjà dans un groupe." />
              <form class="grid gap-3 md:grid-cols-[1fr_12rem_auto] md:items-end" onSubmit={addMember}>
                <label class="flex flex-col gap-1.5 text-sm">
                  <span class="font-medium">Projet</span>
                  <select
                    class="h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3"
                    value={addProject}
                    onChange={(e) => setAddProject((e.target as HTMLSelectElement).value)}
                  >
                    <option value="">Choisir…</option>
                    {candidates.map((p) => (
                      <option key={p.uuid} value={p.uuid}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <Input
                    label="Rôle"
                    value={addRole}
                    list="group-roles"
                    onInput={(e) => setAddRole((e.target as HTMLInputElement).value)}
                  />
                  <datalist id="group-roles">
                    {ROLE_HINTS.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </div>
                <Button type="submit" disabled={busy || !addProject || !addRole.trim()}>
                  Relier
                </Button>
              </form>
            </Card>

            <Card class="border-[var(--color-danger)]/30">
              <CardHeader title="Dissoudre le groupe" description="Les projets restent. Seul le lien disparaît." />
              <Button variant="danger" disabled={busy} onClick={removeGroup}>
                Supprimer le groupe
              </Button>
            </Card>
          </div>
        </FadeIn>
      )}
    </>
  );
}

function MemberRow({
  member,
  busy,
  onRole,
  onGpu,
  onRemove,
}: {
  member: AppGroup['members'][number];
  busy: boolean;
  onRole: (role: string) => void;
  onGpu: (nvidia: boolean, dri: boolean) => void;
  onRemove: () => void;
}) {
  const [role, setRole] = useState(member.role);
  const status = projectStatusMeta(member.status);
  useEffect(() => setRole(member.role), [member.role]);

  return (
    <li class="flex flex-col gap-3 py-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <a
            class="font-medium hover:underline"
            href={`/app/projects/view?uuid=${encodeURIComponent(member.project_uuid)}`}
          >
            {member.name}
          </a>
          <p class="text-xs text-[var(--color-ink-muted)]">
            {status.label}
            {member.server_id ? ` · nœud ${member.server_id}` : ''} · {member.internal_url}
          </p>
        </div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
          Retirer
        </Button>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <div class="w-40">
          <Input label="Rôle" value={role} list="group-roles" onInput={(e) => setRole((e.target as HTMLInputElement).value)} />
        </div>
        <Button size="sm" variant="outline" disabled={busy || role.trim() === member.role} onClick={() => onRole(role.trim())}>
          Rôle
        </Button>
        <label class="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={member.gpu_nvidia}
            disabled={busy}
            onChange={(e) => onGpu((e.target as HTMLInputElement).checked, member.gpu_dri)}
          />
          NVIDIA
        </label>
        <label class="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={member.gpu_dri}
            disabled={busy}
            onChange={(e) => onGpu(member.gpu_nvidia, (e.target as HTMLInputElement).checked)}
          />
          /dev/dri
        </label>
      </div>
    </li>
  );
}

export function ProjectGroupPanel({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  const toast = useToast();
  const [groups, setGroups] = useState<AppGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [role, setRole] = useState('web');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (project.group_uuid) return;
    api
      .groups()
      .then((r) => setGroups(r.data))
      .catch(() => setGroups([]));
  }, [project.group_uuid, project.uuid]);

  async function join(e: Event) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addGroupMember(groupId, { project_uuid: project.uuid, role: role.trim() });
      const fresh = await api.project(project.uuid);
      onChanged(fresh.data);
      toast.push({ title: 'App reliée au groupe', tone: 'ok' });
    } catch (err) {
      toast.push({ title: 'Groupe KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function createAndJoin(e: Event) {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await api.createGroup({ name: newName.trim() });
      await api.addGroupMember(created.data.uuid, { project_uuid: project.uuid, role: role.trim() });
      const fresh = await api.project(project.uuid);
      onChanged(fresh.data);
      toast.push({ title: 'Groupe créé', tone: 'ok' });
    } catch (err) {
      toast.push({ title: 'Groupe KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!project.group_uuid) return;
    setBusy(true);
    try {
      await api.removeGroupMember(project.group_uuid, project.uuid);
      const fresh = await api.project(project.uuid);
      onChanged(fresh.data);
    } catch (err) {
      toast.push({ title: 'Retrait KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (project.group_uuid) {
    return (
      <Card>
        <CardHeader
          title="Groupe"
          description="Réseau partagé et variables DF_* au prochain déploiement."
          action={
            <Button
              size="sm"
              variant="outline"
              href={`/app/groups/view?uuid=${encodeURIComponent(project.group_uuid)}`}
            >
              Ouvrir
            </Button>
          }
        />
        <p class="text-sm">
          <span class="font-medium">{project.group_name}</span>
          {project.role ? <span class="text-[var(--color-ink-muted)]"> · rôle {project.role}</span> : null}
        </p>
        <p class="mt-2 text-xs text-[var(--color-ink-muted)]">
          Les autres apps du groupe sont joignables via <span class="font-mono">DF_{'{ROLE}'}_URL</span> (ex.{' '}
          <span class="font-mono">DF_SERVER_URL=http://server:8080</span>).
        </p>
        <div class="mt-3">
          <Button size="sm" variant="ghost" disabled={busy} onClick={leave}>
            Retirer du groupe
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Groupe" description="Relie cette app à d'autres repos (site, client, serveur)." />
      <form class="mb-4 grid gap-3 md:grid-cols-[1fr_10rem_auto] md:items-end" onSubmit={join}>
        <label class="flex flex-col gap-1.5 text-sm">
          <span class="font-medium">Groupe existant</span>
          <select
            class="h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3"
            value={groupId}
            onChange={(e) => setGroupId((e.target as HTMLSelectElement).value)}
          >
            <option value="">Choisir…</option>
            {groups.map((g) => (
              <option key={g.uuid} value={g.uuid}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <Input label="Rôle" value={role} onInput={(e) => setRole((e.target as HTMLInputElement).value)} />
        <Button type="submit" disabled={busy || !groupId || !role.trim()}>
          Rejoindre
        </Button>
      </form>
      <form class="grid gap-3 md:grid-cols-[1fr_10rem_auto] md:items-end" onSubmit={createAndJoin}>
        <Input label="Nouveau groupe" value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} />
        <Input label="Rôle" value={role} onInput={(e) => setRole((e.target as HTMLInputElement).value)} />
        <Button type="submit" variant="outline" disabled={busy || !newName.trim() || !role.trim()}>
          Créer
        </Button>
      </form>
    </Card>
  );
}
