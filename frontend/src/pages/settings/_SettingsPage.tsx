import { InstanceSettingsPanels, OauthSettingsPanel } from '../../components/settings/InstanceSettingsPanels';
import { SsoSettingsPanel } from '../../components/settings/SsoSettingsPanel';
import { NotificationsSettingsPanel } from '../../components/settings/NotificationsSettingsPanel';
import { InstanceBackupSettingsPanel } from '../../components/settings/InstanceBackupSettingsPanel';
import { ProfileSettingsPanel } from '../../components/settings/ProfileSettingsPanel';
import { SettingsNav } from '../../components/settings/SettingsNav';

import { TeamSettingsPanel } from '../../components/settings/TeamSettingsPanel';
import { SharedVariablesPanel } from '../../components/shared-variables/SharedVariablesPanel';
import { S3StoragesSettings } from '../../components/storages/S3StoragesSettings';
import { PageHeader } from '../../components/PageHeader';
import type { BootstrapPermissions, BootstrapTeam, BootstrapUser } from '../../lib/bootstrap';
import {
    parseNotificationChannel,
    parseSettingsTab,
} from '../../lib/settings-tabs';
import { routeHref } from '../../lib/routes';
import { CoreResourcesPage } from '../resources/_CoreResourcesPage';
import { ProjectsPage } from '../projects/_ProjectsPage';
import { SecurityPage } from './_SecurityPage';

export function SettingsPage({
    path,
    permissions,
    agentsEnabled,
    teams,
    currentTeam,
    user,
    legacyBaseUrl = '',
    onSwitchTeam,
}: {
    path: string;
    permissions: BootstrapPermissions;
    agentsEnabled: boolean;
    teams: BootstrapTeam[];
    currentTeam: BootstrapTeam;
    user: BootstrapUser;
    legacyBaseUrl?: string;
    onSwitchTeam: (teamId: number) => Promise<void>;
}) {
    const activeTab = parseSettingsTab(path);
    const notificationChannel = parseNotificationChannel(path);

    const tabContent = (() => {
        switch (activeTab) {
            case 'projects':
                return <ProjectsPage permissions={permissions} embedded />;
            case 'servers':
                return <CoreResourcesPage key="settings-servers" type="servers" permissions={permissions} embedded />;
            case 'team':
                return (
                    <TeamSettingsPanel
                        teams={teams}
                        currentTeam={currentTeam}
                        canManage={permissions.manage_team}
                        onSwitchTeam={onSwitchTeam}
                    />
                );
            case 'instance':
                return <InstanceSettingsPanels section="instance" permissions={permissions} legacyBaseUrl={legacyBaseUrl} />;
            case 'advanced':
                return <InstanceSettingsPanels section="advanced" permissions={permissions} legacyBaseUrl={legacyBaseUrl} />;
            case 'email':
                return <InstanceSettingsPanels section="email" permissions={permissions} legacyBaseUrl={legacyBaseUrl} />;
            case 'oauth':
                return <OauthSettingsPanel permissions={permissions} legacyBaseUrl={legacyBaseUrl} />;
            case 'sso':
                return <SsoSettingsPanel permissions={permissions} />;
            case 'updates':
                return <InstanceSettingsPanels section="updates" permissions={permissions} legacyBaseUrl={legacyBaseUrl} />;
            case 'backup':
                return <InstanceBackupSettingsPanel />;
            case 'notifications':
                return (
                    <NotificationsSettingsPanel
                        legacyBaseUrl={legacyBaseUrl}
                        activeChannel={notificationChannel}
                        canManage={permissions.manage_team}
                    />
                );
            case 'variables':
                return <SharedVariablesPanel path="/settings/variables" embedded canManage={permissions.manage_team} />;
            case 'security':
                return <SecurityPage embedded path={path} />;
            case 'storages':
                return (
                    <div class="grid gap-2.5 sm:gap-3 md:gap-4">
                        <p class="text-sm text-base-content/60">
                            Gestion complète sur la page{' '}
                            <a class="link link-primary" href={routeHref('/storages')}>Stockage S3</a>.
                        </p>
                        <S3StoragesSettings canManage={permissions.create_resources} />
                    </div>
                );
            default:
                return (
                    <ProfileSettingsPanel
                        legacyBaseUrl={legacyBaseUrl}
                        email={user.email}
                        twoFactorEnabled={user.two_factor_enabled}
                        forcePasswordReset={user.force_password_reset}
                    />
                );
        }
    })();

    return (
        <div class="grid gap-3 sm:gap-4 md:gap-5">
            <PageHeader
                title="Paramètres"
                description="Équipe, organisation, infrastructure et configuration de l’instance."
            />
            <div class="grid min-w-0 gap-3 sm:gap-2.5 sm:gap-3 md:gap-4 md:gap-5 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-8">
                <SettingsNav
                    activeTab={activeTab}
                    agentsEnabled={agentsEnabled}
                    instanceAdmin={permissions.instance_admin}
                />
                <div class="min-w-0 grid gap-2.5 sm:gap-3 md:gap-4">
                    {tabContent}
                </div>
            </div>
        </div>
    );
}
