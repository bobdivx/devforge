import type { BootstrapData } from '../lib/bootstrap';
import type { AppRoute } from '../lib/routes';
import { extractApplicationUuid } from '../lib/routes';
import { AgentDetailPage } from './_AgentDetailPage';
import { AgentsPage } from './_AgentsPage';
import { CoreResourcesPage } from './_CoreResourcesPage';
import { DeploymentsPage } from './_DeploymentsPage';
import { MonitoringPage } from './_MonitoringPage';
import { OverviewPage } from './_OverviewPage';
import { SettingsPage } from './_SettingsPage';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';

type DomainPageProps = {
    bootstrap: BootstrapData;
    route: AppRoute;
    onSwitchTeam: (teamId: number) => Promise<void>;
};

export function DomainPage({ bootstrap, route, onSwitchTeam }: DomainPageProps) {
    switch (route.page) {
        case 'dashboard':
            return <OverviewPage />;
        case 'applications':
        case 'application-detail':
            return (
                <CoreResourcesPage
                    key="applications"
                    type="applications"
                    permissions={bootstrap.permissions}
                    legacyBaseUrl={bootstrap.migration.legacy_base_url}
                    initialResourceUuid={extractApplicationUuid(route.path)}
                />
            );
        case 'databases':
            return <CoreResourcesPage key="databases" type="databases" permissions={bootstrap.permissions} />;
        case 'services':
            return <CoreResourcesPage key="services" type="services" permissions={bootstrap.permissions} />;
        case 'deployments':
            return <DeploymentsPage />;
        case 'monitoring':
            return <MonitoringPage />;
        case 'settings':
            return (
                <SettingsPage
                    path={route.path}
                    permissions={bootstrap.permissions}
                    agentsEnabled={bootstrap.features?.agents_enabled ?? false}
                    teams={bootstrap.teams}
                    currentTeam={bootstrap.current_team}
                    onSwitchTeam={onSwitchTeam}
                />
            );
        case 'agents':
            return (bootstrap.features?.agents_enabled ?? false)
                ? <AgentsPage />
                : (
                    <>
                        <PageHeader title="Agents IA" description="Fonctionnalité désactivée sur cette instance." eyebrow="Indisponible" />
                        <Card title="Agents désactivés">
                            <p class="text-sm text-base-content/65">
                                Activez <code class="text-xs">DEVFORGE_AGENTS_ENABLED=true</code> et exécutez les migrations pour utiliser les agents IA.
                            </p>
                        </Card>
                    </>
                );
        case 'agent-detail':
            return (bootstrap.features?.agents_enabled ?? false)
                ? (
                    <div class="-m-4">
                        <AgentDetailPage path={route.path} />
                    </div>
                )
                : (
                    <>
                        <PageHeader title="Agents IA" description="Fonctionnalité désactivée sur cette instance." eyebrow="Indisponible" />
                        <Card title="Agents désactivés">
                            <p class="text-sm text-base-content/65">
                                Activez <code class="text-xs">DEVFORGE_AGENTS_ENABLED=true</code> pour utiliser les agents IA.
                            </p>
                        </Card>
                    </>
                );
        case 'not-found':
            return (
                <>
                    <PageHeader title={route.label} description={route.description} eyebrow="Erreur 404" />
                    <Card title="Route inconnue">
                        <p class="text-sm text-base-content/65">Utilisez la navigation DevForge ou revenez à l’interface Coolify.</p>
                    </Card>
                </>
            );
    }
}
