import type { BootstrapData } from '../lib/bootstrap';
import type { AppRoute } from '../lib/routes';
import { extractApplicationUuid } from '../lib/routes';
import { extractGithubAppUuid } from '../lib/settings-tabs';
import { AgentDetailPage } from './_AgentDetailPage';
import { AgentsPage } from './_AgentsPage';
import { CoreResourcesPage } from './_CoreResourcesPage';
import { DeploymentsPage } from './_DeploymentsPage';
import { DestinationsPage } from './_DestinationsPage';
import { MonitoringPage } from './_MonitoringPage';
import { OnboardingPage } from './_OnboardingPage';
import { OverviewPage } from './_OverviewPage';
import { ProfilePage } from './_ProfilePage';
import { SettingsPage } from './_SettingsPage';
import { SharedVariablesPage } from './_SharedVariablesPage';
import { SourcesPage } from './_SourcesPage';
import { ServerPage } from './_ServerPage';
import { StoragesPage } from './storages/_StoragesPage';
import { StoragePage } from './_StoragePage';
import { SubscriptionPage } from './_SubscriptionPage';
import { TagsPage } from './_TagsPage';
import { TerminalPage } from './_TerminalPage';
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
                    user={bootstrap.user}
                    legacyBaseUrl={bootstrap.migration.legacy_base_url}
                    onSwitchTeam={onSwitchTeam}
                />
            );
        case 'shared-variables':
            return (
                <SharedVariablesPage
                    path={route.path}
                    permissions={bootstrap.permissions}
                />
            );
        case 'profile':
            return (
                <ProfilePage
                    path={route.path}
                    user={bootstrap.user}
                    legacyBaseUrl={bootstrap.migration.legacy_base_url}
                />
            );
        case 'terminal':
            return (
                <TerminalPage
                    legacyBaseUrl={bootstrap.migration.legacy_base_url}
                    canAccess={bootstrap.permissions.access_terminal}
                />
            );
        case 'sources':
            return (
                <SourcesPage
                    legacyBaseUrl={bootstrap.migration.legacy_base_url}
                    githubAppUuid={extractGithubAppUuid(route.path)}
                />
            );
        case 'destinations':
            return (
                <DestinationsPage
                    path={route.path}
                    permissions={bootstrap.permissions}
                    legacyBaseUrl={bootstrap.migration.legacy_base_url}
                />
            );
        case 'tags':
            return (
                <TagsPage
                    path={route.path}
                    permissions={bootstrap.permissions}
                    legacyBaseUrl={bootstrap.migration.legacy_base_url}
                />
            );
        case 'subscription':
            return <SubscriptionPage bootstrap={bootstrap} />;
        case 'onboarding':
            return <OnboardingPage bootstrap={bootstrap} />;
        case 'storage':
            return <StoragePage permissions={bootstrap.permissions} />;
        case 'storages':
            return (
                <StoragesPage
                    path={route.path}
                    permissions={bootstrap.permissions}
                    legacyBaseUrl={bootstrap.migration.legacy_base_url}
                />
            );
        case 'server-detail':
            return (
                <ServerPage
                    path={route.path}
                    legacyBaseUrl={bootstrap.migration.legacy_base_url}
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
