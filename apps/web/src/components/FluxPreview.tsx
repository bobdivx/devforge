import { useState } from 'preact/hooks';
import { EmptyAppGrid } from './HomePage';
import { OnboardingWizard } from './OnboardingPage';
import { McpCatalogGroups, type CatalogItem } from './McpPage';
import { DeployTimeline } from './workspace/DeployTimeline';
import { DiagFiches } from './DiagFiches';
import { VersionDelta } from './VersionDelta';
import { Button, HubGrid } from './ui';

const FAILED_LOGS = `[git] fetch origin
[build] npm run build
[blue-green] starting new container
healthcheck timeout
error: failed to probe /`;

const DIAG = `=== uptime ===
up 2 days
=== disk ===
/dev/sda1  20G  19G  1.0G  95% /
=== docker ===
NAMES    STATUS
app-web  Up
=== df-* ===
app-web  Up
`;

const CATALOG: CatalogItem[] = [
  {
    id: 'turso',
    name: 'Turso',
    description: 'Bases libSQL edge. Liste tes DBs et relie-les à un projet.',
    category: 'database',
    fields: [],
    popular: true,
    tools_help: 'Liste les bases et relie une URL au projet.',
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'Postgres serverless, une base par branche.',
    category: 'database',
    fields: [],
    popular: false,
    tools_help: 'Crée une base et récupère la chaîne de connexion.',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'DNS, Tunnel, Workers, R2.',
    category: 'infrastructure',
    fields: [],
    popular: true,
    tools_help: 'Lit les zones DNS et ouvre un tunnel.',
  },
];

const NOTES = [
  'Le routage signale un réseau Docker manquant.',
  'La fiche d’une étape en échec s’ouvre depuis la timeline.',
  'La grille vide propose l’import ou l’agent.',
];

/** Montage local des six surfaces, pour les exercer sans instance. */
export function FluxPreview() {
  const [picked, setPicked] = useState<string | null>(null);
  const [mcp, setMcp] = useState<string | null>(null);

  return (
    <div class="mx-auto max-w-5xl space-y-16 px-4 py-10">
      <section id="portes">
        <OnboardingWizard />
      </section>

      <section id="grille" class="space-y-3">
        <HubGrid cols={5}>
          <EmptyAppGrid
            agentBuilder
            onAgent={() => setPicked('agent')}
            onImport={() => setPicked('import')}
          />
        </HubGrid>
        {picked && (
          <p class="text-sm text-[var(--color-ink-muted)]" data-df-empty-picked={picked}>
            {picked === 'agent' ? 'Agent ouvert.' : 'Import ouvert.'}
          </p>
        )}
      </section>

      <section id="echec" class="max-w-xl">
        <DeployTimeline logs={FAILED_LOGS} status="failed" />
      </section>

      <section id="diag" class="max-w-xl space-y-3">
        <DiagFiches text={DIAG} />
      </section>

      <section id="mcp">
        <McpCatalogGroups
          items={CATALOG}
          connectedIds={new Set()}
          onOpen={(item) => setMcp(item.name)}
        />
        {mcp && (
          <p class="mt-3 text-sm text-[var(--color-ink-muted)]" data-df-mcp-picked={mcp}>
            {mcp}
          </p>
        )}
      </section>

      <section id="delta" class="max-w-md space-y-3">
        <VersionDelta version="2.0.174" notes={NOTES} />
        <Button>Mettre à jour</Button>
      </section>
    </div>
  );
}
