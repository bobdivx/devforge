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

const DISMISS_KEY = 'devforge.group-suggest-dismissed';
const GENERIC_TOKENS = new Set([
  'web',
  'client',
  'server',
  'api',
  'app',
  'frontend',
  'backend',
  'site',
  'www',
  'ui',
  'public',
  'admin',
]);

function nameStem(name: string): string {
  const tokens = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t));
  return tokens.join('-');
}

function similarProjects(project: Project, all: Project[]): Project[] {
  const stem = nameStem(project.name);
  if (stem.length < 3) return [];
  return all.filter((other) => {
    if (other.uuid === project.uuid) return false;
    const otherStem = nameStem(other.name);
    if (otherStem.length < 3) return false;
    return stem === otherStem || stem.startsWith(`${otherStem}-`) || otherStem.startsWith(`${stem}-`);
  });
}

function isSuggestDismissed(uuid: string): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) && ids.includes(uuid);
  } catch {
    return false;
  }
}

function dismissSuggest(uuid: string) {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
    if (!next.includes(uuid)) next.push(uuid);
    localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
  } catch {
    /* stockage indisponible */
  }
}

export function ProjectGroupSuggest({ project }: { project: Project }) {
  const [matches, setMatches] = useState<Project[]>([]);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (project.group_uuid || isSuggestDismissed(project.uuid)) {
      setHidden(true);
      setMatches([]);
      return;
    }
    let cancelled = false;
    api
      .projects()
      .then((r) => {
        if (cancelled) return;
        const found = similarProjects(project, r.data);
        setMatches(found);
        setHidden(found.length === 0);
      })
      .catch(() => {
        if (!cancelled) setHidden(true);
      });
    return () => {
      cancelled = true;
    };
  }, [project.uuid, project.name, project.group_uuid]);

  if (hidden || matches.length === 0) return null;

  const names = matches.map((p) => p.name).join(', ');

  return (
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)]/70 px-4 py-3">
      <p class="min-w-0 text-sm">
        Apps au nom proche : <span class="font-medium">{names}</span>
      </p>
      <div class="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          href={`/app/projects/view?uuid=${encodeURIComponent(project.uuid)}&tab=settings`}
        >
          Regrouper
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            dismissSuggest(project.uuid);
            setHidden(true);
          }}
        >
          Ignorer
        </Button>
      </div>
    </div>
  );
}

const ROLE_OPTIONS = [
  { id: 'web', label: 'Web' },
  { id: 'client', label: 'Client' },
  { id: 'server', label: 'Serveur' },
  { id: 'api', label: 'API' },
] as const;

type Assignment = {
  key: string;
  projectUuid: string;
  locked: boolean;
  roleChoice: string;
  customRole: string;
};

function roleChoiceFrom(role: string | null | undefined): Pick<Assignment, 'roleChoice' | 'customRole'> {
  const value = (role || '').trim();
  if (ROLE_OPTIONS.some((option) => option.id === value)) {
    return { roleChoice: value, customRole: '' };
  }
  if (!value) return { roleChoice: 'web', customRole: '' };
  return { roleChoice: 'custom', customRole: value };
}

function resolvedRole(row: Assignment): string {
  if (row.roleChoice === 'custom') return row.customRole.trim();
  return row.roleChoice;
}

function groupLabel(project: Project): string {
  const stem = nameStem(project.name);
  const base = stem || project.name.trim();
  if (!base) return 'Groupe';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function RoleMenu({
  row,
  taken,
  onChange,
}: {
  row: Assignment;
  taken: Set<string>;
  onChange: (next: Pick<Assignment, 'roleChoice' | 'customRole'>) => void;
}) {
  return (
    <div class="flex min-w-0 flex-1 flex-col gap-2 sm:max-w-xs">
      <select
        class="h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm"
        value={row.roleChoice}
        onChange={(e) => {
          const roleChoice = (e.target as HTMLSelectElement).value;
          onChange({
            roleChoice,
            customRole: roleChoice === 'custom' ? row.customRole : '',
          });
        }}
      >
        {ROLE_OPTIONS.map((option) => (
          <option key={option.id} value={option.id} disabled={taken.has(option.id) && row.roleChoice !== option.id}>
            {option.label}
          </option>
        ))}
        <option value="custom">Personnalisé</option>
      </select>
      {row.roleChoice === 'custom' && (
        <input
          class="h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm"
          placeholder="Rôle personnalisé"
          value={row.customRole}
          onInput={(e) =>
            onChange({ roleChoice: 'custom', customRole: (e.target as HTMLInputElement).value })
          }
        />
      )}
    </div>
  );
}

export function ProjectGroupPanel({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [rows, setRows] = useState<Assignment[]>(() => [
    {
      key: project.uuid,
      projectUuid: project.uuid,
      locked: true,
      ...roleChoiceFrom(project.role),
    },
  ]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .projects()
      .then(async (listed) => {
        if (cancelled) return;
        setProjects(listed.data);
        if (!project.group_uuid) {
          setRows([
            {
              key: project.uuid,
              projectUuid: project.uuid,
              locked: true,
              ...roleChoiceFrom(project.role),
            },
          ]);
          return;
        }
        const group = await api.group(project.group_uuid);
        if (cancelled) return;
        const members = group.data.members;
        const current = members.find((member) => member.project_uuid === project.uuid);
        const others = members.filter((member) => member.project_uuid !== project.uuid);
        setRows([
          {
            key: project.uuid,
            projectUuid: project.uuid,
            locked: true,
            ...roleChoiceFrom(current?.role || project.role),
          },
          ...others.map((member) => ({
            key: member.project_uuid,
            projectUuid: member.project_uuid,
            locked: false,
            ...roleChoiceFrom(member.role),
          })),
        ]);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project.uuid, project.group_uuid, project.role]);

  const taken = new Set(rows.map(resolvedRole).filter(Boolean));
  const chosen = new Set(rows.map((row) => row.projectUuid).filter(Boolean));
  const candidates = projects.filter(
    (item) => !item.group_uuid || item.group_uuid === project.group_uuid,
  );

  function patchRow(key: string, patch: Partial<Assignment>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function save(e: Event) {
    e.preventDefault();
    const filled = rows.filter((row) => row.projectUuid);
    if (filled.length < 2) {
      toast.push({ title: 'Choisis au moins une autre app', tone: 'warn' });
      return;
    }
    if (filled.some((row) => !resolvedRole(row))) {
      toast.push({ title: 'Chaque app a besoin d’un rôle', tone: 'warn' });
      return;
    }
    const roles = filled.map(resolvedRole);
    if (new Set(roles).size !== roles.length) {
      toast.push({ title: 'Chaque rôle doit être unique', tone: 'warn' });
      return;
    }
    setBusy(true);
    try {
      let groupUuid = project.group_uuid || '';
      if (!groupUuid) {
        const created = await api.createGroup({ name: groupLabel(project) });
        groupUuid = created.data.uuid;
        for (const row of filled) {
          await api.addGroupMember(groupUuid, {
            project_uuid: row.projectUuid,
            role: resolvedRole(row),
          });
        }
      } else {
        const current = await api.group(groupUuid);
        const previous = new Map(current.data.members.map((member) => [member.project_uuid, member.role]));
        for (const member of current.data.members) {
          if (!filled.some((row) => row.projectUuid === member.project_uuid)) {
            await api.removeGroupMember(groupUuid, member.project_uuid);
          }
        }
        for (const row of filled) {
          const role = resolvedRole(row);
          const before = previous.get(row.projectUuid);
          if (!before) {
            await api.addGroupMember(groupUuid, { project_uuid: row.projectUuid, role });
          } else if (before !== role) {
            await api.updateGroupMember(groupUuid, row.projectUuid, { role });
          }
        }
      }
      const fresh = await api.project(project.uuid);
      onChanged(fresh.data);
      toast.push({ title: 'Groupe enregistré', detail: 'Redéploie pour appliquer le lien.', tone: 'ok' });
    } catch (err) {
      toast.push({ title: 'Groupe KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={project.group_name ? `Groupe ${project.group_name}` : 'Groupe'}
        description="Choisis les apps et un rôle pour chacune."
        action={
          project.group_uuid ? (
            <Button
              size="sm"
              variant="ghost"
              href={`/app/groups/view?uuid=${encodeURIComponent(project.group_uuid)}`}
            >
              Ouvrir
            </Button>
          ) : undefined
        }
      />
      <form class="space-y-3" onSubmit={save}>
        {rows.map((row) => (
          <div key={row.key} class="flex flex-col gap-2 sm:flex-row sm:items-start">
            {row.locked ? (
              <div class="flex h-10 min-w-0 flex-1 items-center rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm">
                {project.name}
              </div>
            ) : (
              <select
                class="h-10 min-w-0 flex-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm"
                value={row.projectUuid}
                onChange={(e) => patchRow(row.key, { projectUuid: (e.target as HTMLSelectElement).value })}
              >
                <option value="">Choisir un projet…</option>
                {candidates
                  .filter((item) => item.uuid === row.projectUuid || !chosen.has(item.uuid))
                  .filter((item) => item.uuid !== project.uuid)
                  .map((item) => (
                    <option key={item.uuid} value={item.uuid}>
                      {item.name}
                    </option>
                  ))}
              </select>
            )}
            <RoleMenu
              row={row}
              taken={taken}
              onChange={(next) => patchRow(row.key, next)}
            />
            {!row.locked && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
              >
                Retirer
              </Button>
            )}
          </div>
        ))}
        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setRows((current) => {
                const used = new Set(current.map(resolvedRole).filter(Boolean));
                const free = ROLE_OPTIONS.find((option) => !used.has(option.id));
                return [
                  ...current,
                  {
                    key: `new-${Date.now()}`,
                    projectUuid: '',
                    locked: false,
                    roleChoice: free?.id ?? 'custom',
                    customRole: '',
                  },
                ];
              })
            }
          >
            Ajouter un projet
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
