import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { AppShell } from './AppShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  Skeleton,
  Table,
  Td,
  Tr,
  useToast,
} from './ui';

type WorkspaceRow = {
  uuid: string;
  name: string;
  slug: string;
  plan: string;
  created_at: string;
  project_count: number;
  owner: { uuid: string; email: string; name: string; role: string };
};

type Stats = {
  workspaces: number;
  users: number;
  plan_free: number;
  plan_pro: number;
  projects: number;
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function AdminBody() {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [busyUuid, setBusyUuid] = useState<string | null>(null);
  const toast = useToast();

  async function load() {
    try {
      const r = await api.adminOverview();
      setStats(r.stats);
      setWorkspaces(r.workspaces);
      setForbidden(false);
    } catch (err) {
      const msg = String((err as Error).message || err);
      if (msg.toLowerCase().includes('admin') || msg.toLowerCase().includes('réservé')) {
        setForbidden(true);
      } else {
        toast.push({ title: 'Erreur', detail: msg, tone: 'danger' });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function setPlan(uuid: string, plan: 'free' | 'pro') {
    setBusyUuid(uuid);
    try {
      await api.adminUpdateWorkspace(uuid, { plan });
      setWorkspaces((list) => list.map((w) => (w.uuid === uuid ? { ...w, plan } : w)));
      setStats((s) => {
        if (!s) return s;
        const prev = workspaces.find((w) => w.uuid === uuid)?.plan;
        if (!prev || prev === plan) return s;
        return {
          ...s,
          plan_free: s.plan_free + (plan === 'free' ? 1 : -1),
          plan_pro: s.plan_pro + (plan === 'pro' ? 1 : -1),
        };
      });
      toast.push({
        title: 'Forfait mis à jour',
        detail: plan === 'pro' ? 'Accès Pro' : 'Passage Free',
        tone: 'ok',
      });
    } catch (err) {
      toast.push({
        title: 'Échec',
        detail: String((err as Error).message || err),
        tone: 'danger',
      });
    } finally {
      setBusyUuid(null);
    }
  }

  if (forbidden) {
    return <Alert tone="warn">Réservé à l’administrateur d’instance.</Alert>;
  }

  if (loading) {
    return (
      <div class="space-y-4">
        <Skeleton class="h-24" />
        <Skeleton class="h-48" />
      </div>
    );
  }

  return (
    <div class="space-y-6">
      {stats && (
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Workspaces', value: stats.workspaces },
            { label: 'Utilisateurs', value: stats.users },
            { label: 'Free', value: stats.plan_free },
            { label: 'Pro', value: stats.plan_pro },
          ].map((s) => (
            <Card key={s.label} class="!p-4">
              <p class="text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                {s.label}
              </p>
              <p class="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader
          title="Workspaces clients"
          action={
            <Button href="/register" size="sm" variant="outline">
              Lien inscription
            </Button>
          }
        />
        <p class="mb-4 text-sm text-[var(--color-ink-muted)]">
          Chaque inscription crée un workspace isolé en forfait free. Passe un client en Pro pour
          débloquer les quotas (billing Stripe à brancher ensuite).
        </p>
        {workspaces.length === 0 ? (
          <Alert tone="info">Aucun workspace pour l’instant.</Alert>
        ) : (
          <Table headers={['Owner', 'Workspace', 'Projets', 'Forfait', 'Depuis', '']}>
            {workspaces.map((w) => (
              <Tr key={w.uuid}>
                <Td>
                  <div>
                    <p class="font-medium text-[var(--color-ink)]">{w.owner.name}</p>
                    <p class="text-xs text-[var(--color-ink-faint)]">{w.owner.email}</p>
                  </div>
                </Td>
                <Td>
                  <div>
                    <p class="text-[var(--color-ink)]">{w.name}</p>
                    <p class="text-xs text-[var(--color-ink-faint)]">{w.slug}</p>
                    {w.owner.role === 'instance_admin' && (
                      <Badge tone="accent" class="mt-1">
                        Admin instance
                      </Badge>
                    )}
                  </div>
                </Td>
                <Td>
                  <span class="tabular-nums text-[var(--color-ink)]">{w.project_count}</span>
                </Td>
                <Td>
                  <Badge tone={w.plan === 'pro' ? 'accent' : 'neutral'}>{w.plan}</Badge>
                </Td>
                <Td>
                  <span class="text-xs">{formatDate(w.created_at)}</span>
                </Td>
                <Td>
                  <div class="flex flex-wrap justify-end gap-1.5">
                    {w.plan !== 'pro' ? (
                      <Button
                        size="sm"
                        disabled={busyUuid === w.uuid}
                        onClick={() => setPlan(w.uuid, 'pro')}
                      >
                        → Pro
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyUuid === w.uuid}
                        onClick={() => setPlan(w.uuid, 'free')}
                      >
                        → Free
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

export function AdminPage() {
  return (
    <AppShell
      active="admin"
      title="Admin"
      description="Clients et forfaits — cockpit opérateur de l’instance."
    >
      <FadeIn>
        <AdminBody />
      </FadeIn>
    </AppShell>
  );
}
