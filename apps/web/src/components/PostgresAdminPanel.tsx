import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { Alert, Badge, Button, Card, CardHeader, FadeIn, Skeleton } from './ui';

type PostgresStatus = {
  ready: boolean;
  engine: string;
  placement?: string;
  container?: string;
  standby_container?: string;
  host?: string;
  database?: string;
  user?: string;
  port?: number;
  public?: boolean;
  replicas_streaming?: number;
  durability?: string;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div class="flex items-center justify-between gap-4 border-b border-[var(--color-line)] py-2 text-sm last:border-0">
      <span class="text-[var(--color-ink-muted)]">{label}</span>
      <span class="font-mono text-[var(--color-ink)]">{value}</span>
    </div>
  );
}

export function PostgresAdminPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pg, setPg] = useState<PostgresStatus | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.postgresStatus();
      setPg(res.postgres);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Postgres indisponible');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const streaming = pg?.replicas_streaming ?? 0;
  const durability =
    pg?.durability === 'remote_apply'
      ? 'commit synchrone (remote_apply)'
      : pg?.durability === 'local'
        ? 'commit local'
        : 'inconnu';

  return (
    <FadeIn>
      <Card>
        <CardHeader
          title="Postgres du control plane"
          description="Utilisateurs, projets, sessions et cluster. Les bases d'apps restent dans l'onglet Database de chaque projet."
          action={
            <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
              Actualiser
            </Button>
          }
        />
        {loading && <Skeleton class="h-32" />}
        {error && <Alert tone="danger">{error}</Alert>}
        {pg && !loading && (
          <div class="space-y-4">
            <div class="flex flex-wrap gap-2">
              <Badge tone={pg.ready ? 'ok' : 'warn'}>{pg.ready ? 'prêt' : 'pas démarré'}</Badge>
              <Badge>{pg.placement ?? pg.engine}</Badge>
              {pg.public ? <Badge tone="ok">port publié</Badge> : <Badge tone="warn">écoute locale</Badge>}
              <Badge tone={streaming > 0 ? 'ok' : 'warn'}>
                {streaming > 0 ? `${streaming} réplique en streaming` : 'aucune réplique en streaming'}
              </Badge>
            </div>
            <div>
              <Row label="Moteur" value={pg.engine} />
              {pg.container && <Row label="Conteneur" value={pg.container} />}
              {pg.standby_container && <Row label="Réplique" value={pg.standby_container} />}
              {pg.host && <Row label="Hôte" value={pg.host} />}
              {pg.database && <Row label="Base" value={pg.database} />}
              {pg.user && <Row label="Utilisateur" value={pg.user} />}
              {pg.port != null && <Row label="Port" value={String(pg.port)} />}
              <Row label="Durabilité" value={durability} />
            </div>
            {streaming === 0 && pg.public && (
              <Alert tone="warn">
                Aucun worker ne rejoue le WAL. Le failover retombe sur un dump, avec du retard.
                Vérifie que le port {pg.port ?? 5433} est joignable depuis les autres nœuds.
              </Alert>
            )}
            {!pg.public && pg.placement === 'conteneur' && (
              <Alert tone="warn">
                Postgres n'est pas publié. Les workers ne peuvent pas ouvrir de réplique streaming.
              </Alert>
            )}
          </div>
        )}
      </Card>
    </FadeIn>
  );
}
