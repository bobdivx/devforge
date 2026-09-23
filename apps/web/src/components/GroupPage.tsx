import { useEffect, useState } from 'preact/hooks';
import { api, type AppGroup, type InstanceDomain, type Project } from '../lib/api';
import { cn } from '../lib/cn';
import { projectStatusMeta } from '../lib/status';
import { AppIcon, groupFaceProject, statusDotClass } from './AppIcon';
import { AppShell } from './AppShell';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  FadeIn,
  HubAddTile,
  HubGrid,
  HubIcon,
  HubTile,
  Input,
  Modal,
  Skeleton,
} from './ui';
import { useToast } from './ui/Toast';

const ROLE_HINTS = ['web', 'client', 'server', 'api'];

export function GroupPage() {
  const uuid = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('uuid') || '';
  return <GroupBody uuid={uuid} />;
}

function GroupBody({ uuid }: { uuid: string }) {
  const toast = useToast();
  const [group, setGroup] = useState<AppGroup | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [domainApex, setDomainApex] = useState('');
  const [domains, setDomains] = useState<InstanceDomain[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addProject, setAddProject] = useState('');
  const [addRole, setAddRole] = useState('server');
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
      setDomainApex(g.data.domain_apex || '');
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
    api
      .instanceDomains()
      .then((r) => setDomains(r.data ?? []))
      .catch(() => setDomains([]));
  }, [uuid]);

  async function pickGroupDomain(next: string) {
    if (!group || busy || next === (group.domain_apex || '')) return;
    const previous = group.domain_apex || '';
    setDomainApex(next);
    setBusy(true);
    try {
      const r = await api.updateGroup(group.uuid, { domain_apex: next });
      setGroup(r.data);
      setDomainApex(r.data.domain_apex || '');
      toast.push({
        title: next ? `Groupe sur ${next}` : 'Le groupe utilise le domaine principal',
        tone: 'ok',
      });
    } catch (err) {
      setDomainApex(previous);
      toast.push({
        title: 'Domaine non enregistré',
        detail: String(err),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

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
      setAddOpen(false);
      toast.push({ title: 'App reliée', detail: 'Redéploie pour appliquer le réseau et les variables.', tone: 'ok' });
    } catch (err) {
      toast.push({ title: 'Ajout KO', detail: String(err), tone: 'danger' });
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
    <AppShell
      active="home"
      title={group?.name || 'Groupe'}
      description={group ? `Réseau ${group.network}` : undefined}
      actions={
        group ? (
          <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
            Réglages
          </Button>
        ) : undefined
      }
    >
      {error && (
        <Alert tone="warn" class="mb-4">
          {error}
        </Alert>
      )}

      {loading ? (
        <HubGrid cols={5}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} class="aspect-square rounded-2xl" />
          ))}
        </HubGrid>
      ) : (
        group && (
          <HubGrid cols={5}>
            {group.members.map((member, index) => (
              <MemberTile
                key={member.project_uuid}
                member={member}
                project={projectForMember(member, projects)}
                index={index}
              />
            ))}
            <HubAddTile index={group.members.length} label="Ajouter" onClick={() => setAddOpen(true)} />
          </HubGrid>
        )
      )}

      {!loading && group && group.members.length === 0 && (
        <p class="mt-6 text-center text-sm text-[var(--color-ink-muted)]">
          Aucune app dans ce groupe.
        </p>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Ajouter une app"
        description="Projets qui ne sont pas déjà dans un groupe."
        size="md"
      >
        <form class="grid gap-3" onSubmit={addMember}>
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
          {candidates.length === 0 && (
            <p class="text-sm text-[var(--color-ink-muted)]">Tous les projets sont déjà dans un groupe.</p>
          )}
          <Input
            label="Rôle"
            value={addRole}
            list="group-add-roles"
            onInput={(e) => setAddRole((e.target as HTMLInputElement).value)}
          />
          <datalist id="group-add-roles">
            {ROLE_HINTS.map((role) => (
              <option key={role} value={role} />
            ))}
          </datalist>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy || !addProject || !addRole.trim()}>
              Relier
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Réglages du groupe"
        description={
          group
            ? `Réseau ${group.network}. Les apps reçoivent DF_GROUP, DF_ROLE et DF_{ROLE}_URL au déploiement. Même nœud pour tout le groupe.`
            : undefined
        }
        size="md"
      >
        {group && (
          <div class="space-y-6">
            <form class="flex flex-wrap items-end gap-3" onSubmit={rename}>
              <div class="min-w-[12rem] flex-1">
                <Input label="Nom" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
              </div>
              <Button type="submit" disabled={busy || !name.trim()}>
                Renommer
              </Button>
            </form>
            <div class="space-y-3">
              <p class="text-sm text-[var(--color-ink-muted)]">
                Domaine du groupe. Les apps sans domaine propre utilisent cette zone.
              </p>
              <HubGrid cols={3}>
                <HubTile
                  index={0}
                  title="Principal"
                  icon={<HubIcon name="globe" />}
                  class={!domainApex ? '!ring-[var(--color-accent)]' : ''}
                  subtitle={
                    <div class={!domainApex ? 'mt-1 text-[11px] font-medium text-[var(--color-accent)]' : 'mt-1 text-[11px] text-[var(--color-ink-muted)]'}>
                      {!domainApex ? 'Choisie' : 'Par défaut'}
                    </div>
                  }
                  onClick={() => void pickGroupDomain('')}
                />
                {domains.map((row, index) => (
                  <HubTile
                    key={row.apex}
                    index={index + 1}
                    title={row.apex}
                    icon={<HubIcon name="globe" />}
                    class={domainApex === row.apex ? '!ring-[var(--color-accent)]' : ''}
                    subtitle={
                      <div class={domainApex === row.apex ? 'mt-1 text-[11px] font-medium text-[var(--color-accent)]' : 'mt-1 text-[11px] text-[var(--color-ink-muted)]'}>
                        {domainApex === row.apex ? 'Choisie' : row.primary ? 'Principal' : 'Zone'}
                      </div>
                    }
                    onClick={() => void pickGroupDomain(row.apex)}
                  />
                ))}
              </HubGrid>
            </div>
            <div class="border-t border-[var(--color-line)] pt-4">
              <p class="text-sm font-medium">Dissoudre le groupe</p>
              <p class="mt-1 text-sm text-[var(--color-ink-muted)]">
                Les projets restent. Seul le lien disparaît.
              </p>
              <Button class="mt-3" variant="danger" disabled={busy} onClick={removeGroup}>
                Supprimer le groupe
              </Button>
            </div>
          </div>
        )}
      </Modal>

    </AppShell>
  );
}

function projectForMember(member: AppGroup['members'][number], projects: Project[]): Project {
  const found = projects.find((item) => item.uuid === member.project_uuid);
  if (found) {
    return {
      ...found,
      name: found.name || member.name,
      status: found.status || member.status,
      role: member.role || found.role,
      production_url: found.production_url || member.production_url,
    };
  }
  return {
    uuid: member.project_uuid,
    name: member.name,
    slug: member.role,
    status: member.status,
    role: member.role,
    production_url: member.production_url,
    port: member.port,
  };
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    web: 'Web',
    client: 'Client',
    server: 'Serveur',
    api: 'API',
  };
  const key = role.trim().toLowerCase();
  return labels[key] || role;
}

function MemberTile({
  member,
  project,
  index,
}: {
  member: AppGroup['members'][number];
  project: Project;
  index: number;
}) {
  const status = projectStatusMeta(member.status);
  return (
    <HubTile
      index={index}
      title={member.name}
      href={`/app/projects/view?uuid=${encodeURIComponent(member.project_uuid)}`}
      iconClass="!bg-transparent"
      icon={<AppIcon project={project} class="!h-full !w-full !rounded-[1.15rem]" />}
      badge={
        <span
          class={cn(
            'absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full ring-2 ring-[#1c1c1e]',
            statusDotClass(status.tone),
            status.tone === 'ok' || status.tone === 'warn' ? 'animate-pulse' : '',
          )}
          title={status.label}
          aria-hidden
        />
      }
      subtitle={
        <div class="mt-1 space-y-0.5">
          <div
            class={cn(
              'text-[11px] font-medium',
              status.tone === 'ok' && 'text-[var(--color-ok)]',
              status.tone === 'warn' && 'text-[var(--color-warn)]',
              status.tone === 'danger' && 'text-[var(--color-danger)]',
              status.tone === 'neutral' && 'text-[var(--color-ink-faint)]',
            )}
          >
            {status.label}
          </div>
          <div class="truncate text-[10px] text-[var(--color-ink-faint)]">{roleLabel(member.role)}</div>
        </div>
      }
    />
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

function stemsMatch(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3) return false;
  return a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
}

function similarProjects(project: Project, all: Project[]): Project[] {
  const stem = nameStem(project.name);
  if (stem.length < 3) return [];
  return all.filter((other) => other.uuid !== project.uuid && stemsMatch(stem, nameStem(other.name)));
}

type ExistingGroup = {
  uuid: string;
  name: string;
  members: Project[];
};

function existingGroups(all: Project[]): ExistingGroup[] {
  const map = new Map<string, ExistingGroup>();
  for (const item of all) {
    if (!item.group_uuid) continue;
    const bucket = map.get(item.group_uuid) ?? {
      uuid: item.group_uuid,
      name: item.group_name || 'Groupe',
      members: [],
    };
    if (item.group_name) bucket.name = item.group_name;
    bucket.members.push(item);
    map.set(item.group_uuid, bucket);
  }
  return [...map.values()];
}

type GroupSuggestion =
  | { kind: 'join'; group: ExistingGroup }
  | { kind: 'create'; matches: Project[] };

function suggestGroup(project: Project, all: Project[]): GroupSuggestion | null {
  const stem = nameStem(project.name);
  if (stem.length < 3) return null;
  const groups = existingGroups(all).filter(
    (group) =>
      stemsMatch(stem, nameStem(group.name)) ||
      group.members.some((member) => stemsMatch(stem, nameStem(member.name))),
  );
  if (groups.length > 0) {
    groups.sort((a, b) => {
      const aName = stemsMatch(stem, nameStem(a.name)) ? 1 : 0;
      const bName = stemsMatch(stem, nameStem(b.name)) ? 1 : 0;
      if (aName !== bName) return bName - aName;
      const aSim = a.members.filter((member) => stemsMatch(stem, nameStem(member.name))).length;
      const bSim = b.members.filter((member) => stemsMatch(stem, nameStem(member.name))).length;
      if (aSim !== bSim) return bSim - aSim;
      return b.members.length - a.members.length;
    });
    return { kind: 'join', group: groups[0] };
  }
  const matches = similarProjects(project, all).filter((item) => !item.group_uuid);
  if (matches.length === 0) return null;
  return { kind: 'create', matches };
}

function freeRole(project: Project, members: Project[]): string {
  const taken = new Set(
    members.map((member) => (member.role || '').trim().toLowerCase()).filter(Boolean),
  );
  const tokens = project.name.toLowerCase().split(/[^a-z0-9]+/);
  for (const token of tokens) {
    if ((ROLE_HINTS as readonly string[]).includes(token) && !taken.has(token)) return token;
  }
  const free = ROLE_HINTS.find((role) => !taken.has(role));
  if (free) return free;
  const tail = nameStem(project.name).split('-').pop();
  return tail && tail.length >= 2 ? tail.slice(0, 32) : 'app';
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

export function ProjectGroupSuggest({
  project,
  onJoined,
}: {
  project: Project;
  onJoined?: (project: Project) => void;
}) {
  const toast = useToast();
  const [suggestion, setSuggestion] = useState<GroupSuggestion | null>(null);
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (project.group_uuid || isSuggestDismissed(project.uuid)) {
      setHidden(true);
      setSuggestion(null);
      return;
    }
    let cancelled = false;
    api
      .projects()
      .then((r) => {
        if (cancelled) return;
        const found = suggestGroup(project, r.data);
        setSuggestion(found);
        setHidden(!found);
      })
      .catch(() => {
        if (!cancelled) setHidden(true);
      });
    return () => {
      cancelled = true;
    };
  }, [project.uuid, project.name, project.group_uuid]);

  async function join(group: ExistingGroup) {
    setBusy(true);
    try {
      const role = freeRole(project, group.members);
      await api.addGroupMember(group.uuid, { project_uuid: project.uuid, role });
      const fresh = await api.project(project.uuid);
      onJoined?.(fresh.data);
      toast.push({
        title: `Rejoint ${group.name}`,
        detail: 'Redéploie pour appliquer le réseau et les variables.',
        tone: 'ok',
      });
    } catch (err) {
      toast.push({ title: 'Groupe KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (hidden || !suggestion) return null;

  const names =
    suggestion.kind === 'join'
      ? suggestion.group.members.map((item) => item.name).join(', ')
      : suggestion.matches.map((item) => item.name).join(', ');

  return (
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)]/70 px-4 py-3">
      <p class="min-w-0 text-sm">
        {suggestion.kind === 'join' ? (
          <>
            Le groupe <span class="font-medium">{suggestion.group.name}</span> existe déjà
            {names ? <> ({names})</> : null}.
          </>
        ) : (
          <>
            Apps au nom proche : <span class="font-medium">{names}</span>
          </>
        )}
      </p>
      <div class="flex flex-wrap gap-2">
        {suggestion.kind === 'join' ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => join(suggestion.group)}>
            {busy ? 'Rejoindre…' : 'Rejoindre'}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            href={`/app/projects/view?uuid=${encodeURIComponent(project.uuid)}&tab=settings`}
          >
            Regrouper
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
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

  function rowProject(row: Assignment): Project | undefined {
    if (!row.projectUuid) return undefined;
    const base =
      row.projectUuid === project.uuid
        ? project
        : projects.find((item) => item.uuid === row.projectUuid);
    if (!base) return undefined;
    const role = resolvedRole(row);
    return role ? { ...base, role } : base;
  }

  const face = groupFaceProject(
    rows.map(rowProject).filter((item): item is Project => Boolean(item)),
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

  async function leaveGroup() {
    if (!project.group_uuid) return;
    setBusy(true);
    try {
      await api.removeGroupMember(project.group_uuid, project.uuid);
      const fresh = await api.project(project.uuid);
      onChanged(fresh.data);
      toast.push({ title: 'Retiré du groupe', tone: 'ok' });
    } catch (err) {
      toast.push({ title: 'Retrait KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-1 items-start gap-3">
          {face && <AppIcon project={face} size="sm" class="shrink-0" />}
          <div class="min-w-0">
            <h2 class="text-sm font-medium tracking-tight text-[var(--color-ink)]">
              {project.group_name ? `Groupe ${project.group_name}` : 'Groupe'}
            </h2>
            <p class="mt-1 text-sm text-[var(--color-ink-muted)]">
              Choisis les apps et un rôle pour chacune.
            </p>
          </div>
        </div>
        {project.group_uuid && (
          <div class="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              href={`/app/groups/view?uuid=${encodeURIComponent(project.group_uuid)}`}
            >
              Ouvrir le groupe
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void leaveGroup()}>
              Retirer du groupe
            </Button>
          </div>
        )}
      </div>
      <form class="space-y-3" onSubmit={save}>
        {rows.map((row) => {
          const logo = rowProject(row);
          return (
          <div key={row.key} class="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div class="flex min-w-0 flex-1 items-center gap-2">
              {logo && <AppIcon project={logo} size="sm" class="shrink-0" />}
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
            </div>
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
          );
        })}
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
