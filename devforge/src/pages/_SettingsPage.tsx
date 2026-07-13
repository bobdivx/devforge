import { RefreshCw, Save } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { AiProvidersSettings } from '../components/agents/AiProvidersSettings';
import { S3StoragesSettings } from '../components/storages/S3StoragesSettings';
import { PageHeader } from '../components/PageHeader';
import { TeamSwitcher } from '../components/TeamSwitcher';
import { Card } from '../components/ui/Card';
import { DataState } from '../components/ui/DataState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Tabs } from '../components/ui/Tabs';
import type { BootstrapPermissions, BootstrapTeam } from '../lib/bootstrap';
import { domainApi } from '../lib/domain-api';
import { parseSettingsTab, settingsTabPath, visibleSettingsTabs, type SettingsTabId } from '../lib/settings-tabs';
import { useApiQuery } from '../lib/use-api-query';
import { navigateTo } from '../lib/use-navigate';
import { CoreResourcesPage } from './_CoreResourcesPage';
import { ProjectsPage } from './_ProjectsPage';
import { SecurityPage } from './_SecurityPage';

function ProfileCard() {
    const query = useApiQuery('profile', () => domainApi.profile());
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const profile = query.data?.data;

    return (
        <Card title="Profil">
            <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                {profile && (
                    <form
                        class="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
                        onSubmit={async (event) => {
                            event.preventDefault();
                            const form = new FormData(event.currentTarget);
                            setSaving(true);
                            setMessage(null);
                            try {
                                await domainApi.updateProfile({
                                    name: String(form.get('name') ?? ''),
                                    email: String(form.get('email') ?? ''),
                                });
                                await query.reload();
                                setMessage('Profil enregistré.');
                            } catch {
                                setMessage('Échec de la mise à jour.');
                            } finally {
                                setSaving(false);
                            }
                        }}
                    >
                        <label class="grid gap-1.5 text-sm">
                            <span class="font-medium">Nom</span>
                            <input class="input input-bordered rounded-xl" name="name" required defaultValue={profile.name} />
                        </label>
                        <label class="grid gap-1.5 text-sm">
                            <span class="font-medium">E-mail</span>
                            <input class="input input-bordered rounded-xl" name="email" type="email" required defaultValue={profile.email} />
                        </label>
                        <button class="btn btn-primary rounded-xl self-end" type="submit" disabled={saving}>
                            <Save class="size-3.5" aria-hidden />
                            {saving ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                        {message && <p class="text-sm text-base-content/60 sm:col-span-3" role="status">{message}</p>}
                    </form>
                )}
            </DataState>
        </Card>
    );
}

function InstanceCard({ permissions }: { permissions: BootstrapPermissions }) {
    const settings = useApiQuery('settings', () => domainApi.settings());

    return (
        <Card title="Instance" eyebrow={permissions.instance_admin ? 'Administrateur' : 'Lecture seule'}>
            <DataState loading={settings.loading} error={settings.error} onRetry={() => void settings.reload()}>
                {settings.data && (
                    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
                        <dt class="text-base-content/45">Nom</dt><dd>{settings.data.data.instance_name}</dd>
                        <dt class="text-base-content/45">URL</dt><dd>{settings.data.data.fqdn || 'Non définie'}</dd>
                        <dt class="text-base-content/45">Fuseau</dt><dd>{settings.data.data.instance_timezone}</dd>
                        <dt class="text-base-content/45">API</dt><dd><StatusBadge label={settings.data.data.is_api_enabled ? 'Activée' : 'Désactivée'} tone={settings.data.data.is_api_enabled ? 'success' : 'neutral'} /></dd>
                    </dl>
                )}
            </DataState>
        </Card>
    );
}

function TeamCard({
    teams,
    currentTeam,
    onSwitchTeam,
}: {
    teams: BootstrapTeam[];
    currentTeam: BootstrapTeam;
    onSwitchTeam: (teamId: number) => Promise<void>;
}) {
    const members = useApiQuery('members', () => domainApi.members());

    return (
        <div class="grid gap-4">
            <TeamSwitcher
                teams={teams}
                currentTeam={currentTeam}
                variant="settings"
                onSwitch={onSwitchTeam}
            />
            <Card title="Membres de l’équipe active">
                <DataState loading={members.loading} error={members.error} onRetry={() => void members.reload()}>
                    {members.data && (
                        <ul class="divide-y divide-base-300/70">
                            {members.data.data.map((member) => (
                                <li class="flex items-center justify-between gap-3 py-3" key={member.id}>
                                    <span class="truncate text-sm">{member.name} <span class="text-base-content/40">({member.email})</span></span>
                                    <StatusBadge label={member.role} />
                                </li>
                            ))}
                        </ul>
                    )}
                </DataState>
            </Card>
        </div>
    );
}

function NotificationsCard() {
    const notifications = useApiQuery('notifications', () => domainApi.notifications());

    return (
        <Card title="Notifications">
            <DataState loading={notifications.loading} error={notifications.error} onRetry={() => void notifications.reload()}>
                {notifications.data && (
                    <ul class="divide-y divide-base-300/70">
                        {notifications.data.data.map((channel) => (
                            <li class="flex items-center justify-between gap-2 py-3" key={channel.channel}>
                                <span class="text-sm capitalize">{channel.channel}</span>
                                <StatusBadge label={channel.enabled ? 'Activé' : 'Désactivé'} tone={channel.enabled ? 'success' : 'neutral'} />
                            </li>
                        ))}
                    </ul>
                )}
            </DataState>
        </Card>
    );
}

function VariablesCard() {
    const variables = useApiQuery('shared-variables', () => domainApi.sharedVariables());

    return (
        <Card title="Variables partagées">
            <DataState loading={variables.loading} error={variables.error} onRetry={() => void variables.reload()}>
                {variables.data && (
                    <div class="grid grid-cols-2 gap-3">
                        {Object.entries(variables.data.data).map(([scope, items]) => (
                            <div class="rounded-xl border border-base-300/70 bg-base-200/40 p-3" key={scope}>
                                <p class="text-[11px] font-semibold uppercase tracking-widest text-base-content/45">{scope}</p>
                                <p class="text-2xl font-semibold">{items.length}</p>
                            </div>
                        ))}
                    </div>
                )}
            </DataState>
        </Card>
    );
}

export function SettingsPage({
    path,
    permissions,
    agentsEnabled,
    teams,
    currentTeam,
    onSwitchTeam,
}: {
    path: string;
    permissions: BootstrapPermissions;
    agentsEnabled: boolean;
    teams: BootstrapTeam[];
    currentTeam: BootstrapTeam;
    onSwitchTeam: (teamId: number) => Promise<void>;
}) {
    const activeTab = parseSettingsTab(path);
    const tabs = visibleSettingsTabs(agentsEnabled);

    const settings = useApiQuery('settings', () => domainApi.settings());
    const members = useApiQuery('members', () => domainApi.members());
    const notifications = useApiQuery('notifications', () => domainApi.notifications());
    const variables = useApiQuery('shared-variables', () => domainApi.sharedVariables());

    const reload = async () => {
        await Promise.all([
            settings.reload(),
            members.reload(),
            notifications.reload(),
            variables.reload(),
        ]);
    };

    const tabContent = (() => {
        switch (activeTab) {
            case 'projects':
                return <ProjectsPage permissions={permissions} embedded />;
            case 'servers':
                return <CoreResourcesPage key="settings-servers" type="servers" permissions={permissions} embedded />;
            case 'team':
                return <TeamCard teams={teams} currentTeam={currentTeam} onSwitchTeam={onSwitchTeam} />;
            case 'instance':
                return <InstanceCard permissions={permissions} />;
            case 'notifications':
                return <NotificationsCard />;
            case 'variables':
                return <VariablesCard />;
            case 'security':
                return <SecurityPage embedded />;
            case 'storages':
                return <S3StoragesSettings canManage={permissions.create_resources} />;
            case 'ai':
                return (
                    <Card title="Intelligence Artificielle" eyebrow="Providers LLM">
                        <AiProvidersSettings />
                    </Card>
                );
            default:
                return <ProfileCard />;
        }
    })();

    return (
        <div class="grid gap-5">
            <PageHeader
                title="Paramètres"
                description="Équipe, organisation, infrastructure et configuration de l’instance."
                actions={(
                    <button class="btn btn-ghost rounded-full border border-base-300/80" type="button" onClick={() => void reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                )}
            />
            <Tabs
                items={tabs.map(({ id, label }) => ({ id, label }))}
                active={activeTab}
                onChange={(tabId) => navigateTo(settingsTabPath(tabId as SettingsTabId))}
            />
            <div class="grid gap-4">
                {tabContent}
            </div>
        </div>
    );
}
