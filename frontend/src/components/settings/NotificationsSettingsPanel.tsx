import { RefreshCw, Save } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { ChannelCredentialsEditor } from './ChannelCredentialsEditor';
import { domainApi, type NotificationChannel } from '../../lib/domain-api';
import { notificationEventLabel, sortedNotificationEventKeys } from '../../lib/notification-events';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo } from '../../lib/use-navigate';

const channelLabels: Record<string, string> = {
    email: 'E-mail',
    discord: 'Discord',
    slack: 'Slack',
    telegram: 'Telegram',
    pushover: 'Pushover',
    webhook: 'Webhook',
};

type NotificationsSettingsPanelProps = {
    legacyBaseUrl: string;
    activeChannel?: string | null;
    canManage?: boolean;
};

function ChannelEventsEditor({
    channel,
    canManage,
    onUpdated,
}: {
    channel: NotificationChannel;
    canManage: boolean;
    onUpdated: () => Promise<void>;
}) {
    const [events, setEvents] = useState(channel.events);
    const [enabled, setEnabled] = useState(channel.enabled);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const canToggleEnabled = canManage && channel.channel !== 'email';
    const dirty = JSON.stringify(events) !== JSON.stringify(channel.events) || enabled !== channel.enabled;

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            const payload: { events: Record<string, boolean>; enabled?: boolean } = { events };
            if (canToggleEnabled) {
                payload.enabled = enabled;
            }
            await domainApi.updateNotificationChannel(channel.channel, payload);
            await onUpdated();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div class="grid gap-2.5 sm:gap-3 md:gap-4">
            {canToggleEnabled && (
                <label class="flex items-center justify-between gap-2 sm:gap-3 rounded-lg border border-base-300/70 px-3 py-2 text-sm">
                    <span>Canal activé</span>
                    <input
                        class="toggle toggle-sm"
                        type="checkbox"
                        checked={enabled}
                        disabled={!canManage || saving}
                        onChange={(event) => setEnabled(event.currentTarget.checked)}
                    />
                </label>
            )}
            <ul class="divide-y divide-base-300/70 rounded-lg border border-base-300/70">
                {sortedNotificationEventKeys(events).map((eventKey) => (
                    <li class="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between" key={eventKey}>
                        <span>{notificationEventLabel(eventKey)}</span>
                        <input
                            class="toggle toggle-sm"
                            type="checkbox"
                            checked={events[eventKey] ?? false}
                            disabled={!canManage || saving}
                            onChange={(event) => setEvents((current) => ({
                                ...current,
                                [eventKey]: event.currentTarget.checked,
                            }))}
                        />
                    </li>
                ))}
            </ul>
            {error && <p class="text-sm text-error">{error}</p>}
            {canManage && (
                <button class="btn btn-primary btn-sm w-fit" type="button" disabled={!dirty || saving} onClick={() => void save()}>
                    <Save class="size-3.5" aria-hidden />
                    {saving ? 'Enregistrement…' : 'Enregistrer les événements'}
                </button>
            )}
        </div>
    );
}

export function NotificationsSettingsPanel({ activeChannel = null, canManage = false }: NotificationsSettingsPanelProps) {
    const notifications = useApiQuery('notifications', () => domainApi.notifications());
    const channels = notifications.data?.data ?? [];
    const filtered = activeChannel
        ? channels.filter((item) => item.channel === activeChannel)
        : channels;
    const focusedChannel = filtered[0] ?? null;

    return (
        <div class="grid gap-2.5 sm:gap-3 md:gap-4">
            <Card title={activeChannel ? `Notifications · ${channelLabels[activeChannel] ?? activeChannel}` : 'Notifications'}>
                <div class="card-toolbar mb-3">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void notifications.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </div>
                <DataState
                    loading={notifications.loading}
                    error={notifications.error}
                    empty={filtered.length === 0}
                    emptyMessage="Aucun canal de notification configuré."
                    onRetry={() => void notifications.reload()}
                >
                    {focusedChannel ? (
                        <div class="grid gap-2.5 sm:gap-3 md:gap-4">
                            <ChannelCredentialsEditor
                                key={`${focusedChannel.channel}-creds-${Boolean(focusedChannel.credentials?.discord_webhook_url_set)}-${Boolean(focusedChannel.credentials?.smtp_password_set)}`}
                                channel={focusedChannel}
                                canManage={canManage}
                                onUpdated={notifications.reload}
                            />
                            <ChannelEventsEditor
                                key={`${focusedChannel.channel}-events-${JSON.stringify(focusedChannel.events)}`}
                                channel={focusedChannel}
                                canManage={canManage}
                                onUpdated={notifications.reload}
                            />
                        </div>
                    ) : (
                        <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            {filtered.map((channel) => {
                                const activeEvents = Object.values(channel.events).filter(Boolean).length;

                                return (
                                    <button
                                        class="rounded-2xl border border-base-300/70 p-4 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md"
                                        type="button"
                                        key={channel.channel}
                                        onClick={() => navigateTo(`/notifications/${channel.channel}`)}
                                    >
                                        <div class="mb-2 flex items-start justify-between gap-2">
                                            <p class="text-xs sm:text-sm font-semibold capitalize">{channelLabels[channel.channel] ?? channel.channel}</p>
                                            <StatusBadge
                                                label={channel.enabled ? 'Activé' : 'Désactivé'}
                                                tone={channel.enabled ? 'success' : 'neutral'}
                                            />
                                        </div>
                                        <p class="text-xs text-base-content/55">{activeEvents} événement(s) actif(s)</p>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </DataState>
            </Card>
        </div>
    );
}
