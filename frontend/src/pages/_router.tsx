import type { BootstrapData } from '../lib/bootstrap';
import type { AppRoute } from '../lib/routes';
import { extractApplicationUuid } from '../lib/routes';
import { extractGithubAppUuid } from '../lib/settings-tabs';
import { AgentDetailPage } from './agents/_AgentDetailPage';
import { AgentsPage } from './agents/_AgentsPage';
import { AgentsChatRedirectPage } from './agents/_AgentsChatRedirectPage';
import { AgentsSettingsPage } from './agents/_AgentsSettingsPage';
import { CoreResourcesPage } from './resources/_CoreResourcesPage';
import { DeploymentsPage } from './deployments/_DeploymentsPage';
import { DestinationsPage } from './destinations/_DestinationsPage';
import { MonitoringPage } from './monitoring/_MonitoringPage';
import { RunnersPage } from './runners/_RunnersPage';
import { OnboardingPage } from './onboarding/_OnboardingPage';
import { OverviewPage } from './dashboard/_OverviewPage';
import { ProfilePage } from './profile/_ProfilePage';
import { AutomationPage } from './automation/_AutomationPage';
import { ScheduledTasksPage } from './scheduled-tasks/_ScheduledTasksPage';
import { SettingsPage } from './settings/_SettingsPage';
import { SharedVariablesPage } from './shared-variables/_SharedVariablesPage';
import { ConnexionsPage } from './sources/_SourcesPage';
import { ServerPage } from './servers/_ServerPage';
import { StoragesPage } from './storages/_StoragesPage';
import { StoragePage } from './storage/_StoragePage';
import { SubscriptionPage } from './subscription/_SubscriptionPage';
import { TagsPage } from './tags/_TagsPage';
import { TerminalPage } from './terminal/_TerminalPage';
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
        case 'github-runners':
            return <RunnersPage />;
        case 'settings':
        case 'sso':
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
        case 'connexions':
        case 'github':
        case 'sources':
            return (
                <ConnexionsPage
                    legacyBaseUrl={bootstrap.migration.legacy_base_url}
                    githubAppUuid={extractGithubAppUuid(route.path)}
                    permissions={bootstrap.permissions}
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
                    canManage={bootstrap.permissions.create_resources}
                    canAccessTerminal={bootstrap.permissions.access_terminal}
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
        case 'agents-chat':
            return (bootstrap.features?.agents_enabled ?? false)
                ? <AgentsChatRedirectPage />
                : (
                    <>
                        <PageHeader title="Chat" description="Fonctionnalité désactivée sur cette instance." eyebrow="Indisponible" />
                        <Card title="Agents désactivés">
                            <p class="text-sm text-base-content/65">
                                Activez <code class="text-xs">DEVFORGE_AGENTS_ENABLED=true</code> pour utiliser le chat agents.
                            </p>
                        </Card>
                    </>
                );
        case 'agents-settings':
            return (bootstrap.features?.agents_enabled ?? false)
                ? <AgentsSettingsPage permissions={bootstrap.permissions} />
                : (
                    <>
                        <PageHeader title="Paramètres AI" description="Fonctionnalité désactivée sur cette instance." eyebrow="Indisponible" />
                        <Card title="Agents désactivés">
                            <p class="text-sm text-base-content/65">
                                Activez <code class="text-xs">DEVFORGE_AGENTS_ENABLED=true</code> pour configurer les providers et Ollama.
                            </p>
                        </Card>
                    </>
                );
        case 'agent-detail':
            return (bootstrap.features?.agents_enabled ?? false)
                ? <AgentDetailPage path={route.path} />
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
        case 'scheduled-tasks':
            return <ScheduledTasksPage />;
        case 'automation':
            return <AutomationPage />;
        case 'not-found':
            return (
                <>
                    <PageHeader title={route.label} description={route.description} eyebrow="Erreur 404" />
                    <Card title="Route inconnue">
                        <p class="text-sm text-base-content/65">Utilisez la navigation DevForge ou revenez à l’accueil.</p>
                    </Card>
                </>
            );
    }
}
