import { Save } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { NotificationChannel, NotificationChannelCredentials } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';

type FieldDef =
    | { key: string; label: string; kind: 'boolean' }
    | { key: string; label: string; kind: 'text' | 'password' | 'number'; secret?: boolean; placeholder?: string };

const channelCredentialFields: Record<string, FieldDef[]> = {
    email: [
        { key: 'use_instance_email_settings', label: 'Utiliser les réglages e-mail de l’instance', kind: 'boolean' },
        { key: 'smtp_enabled', label: 'SMTP activé', kind: 'boolean' },
        { key: 'smtp_from_address', label: 'Adresse expéditeur', kind: 'text' },
        { key: 'smtp_from_name', label: 'Nom expéditeur', kind: 'text' },
        { key: 'smtp_recipients', label: 'Destinataires', kind: 'text', placeholder: 'a@example.com,b@example.com' },
        { key: 'smtp_host', label: 'Hôte SMTP', kind: 'text' },
        { key: 'smtp_port', label: 'Port', kind: 'number' },
        { key: 'smtp_encryption', label: 'Chiffrement (starttls, tls, none)', kind: 'text' },
        { key: 'smtp_username', label: 'Utilisateur SMTP', kind: 'text' },
        { key: 'smtp_password', label: 'Mot de passe SMTP', kind: 'password', secret: true },
        { key: 'smtp_timeout', label: 'Timeout SMTP', kind: 'number' },
        { key: 'resend_enabled', label: 'Resend activé', kind: 'boolean' },
        { key: 'resend_api_key', label: 'Clé API Resend', kind: 'password', secret: true },
    ],
    discord: [
        { key: 'discord_webhook_url', label: 'Webhook Discord', kind: 'password', secret: true, placeholder: 'https://discord.com/api/webhooks/…' },
        { key: 'discord_ping_enabled', label: 'Ping @here activé', kind: 'boolean' },
    ],
    slack: [
        { key: 'slack_webhook_url', label: 'Webhook Slack', kind: 'password', secret: true, placeholder: 'https://hooks.slack.com/…' },
    ],
    telegram: [
        { key: 'telegram_token', label: 'Bot token', kind: 'password', secret: true },
        { key: 'telegram_chat_id', label: 'Chat ID', kind: 'password', secret: true },
    ],
    pushover: [
        { key: 'pushover_user_key', label: 'User key', kind: 'password', secret: true },
        { key: 'pushover_api_token', label: 'API token', kind: 'password', secret: true },
    ],
    webhook: [
        { key: 'webhook_url', label: 'URL webhook', kind: 'password', secret: true, placeholder: 'https://…' },
    ],
};

function initialDraft(channel: NotificationChannel): NotificationChannelCredentials {
    const fields = channelCredentialFields[channel.channel] ?? [];
    const source = channel.credentials ?? {};
    const draft: NotificationChannelCredentials = {};

    for (const field of fields) {
        if (field.kind === 'boolean') {
            draft[field.key] = Boolean(source[field.key]);
            continue;
        }
        if (field.secret) {
            draft[field.key] = '';
            continue;
        }
        const value = source[field.key];
        draft[field.key] = value === null || value === undefined ? '' : value;
    }

    return draft;
}

type ChannelCredentialsEditorProps = {
    channel: NotificationChannel;
    canManage: boolean;
    onUpdated: () => Promise<void>;
};

export function ChannelCredentialsEditor({ channel, canManage, onUpdated }: ChannelCredentialsEditorProps) {
    const fields = channelCredentialFields[channel.channel] ?? [];
    const [draft, setDraft] = useState(() => initialDraft(channel));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    if (fields.length === 0) {
        return null;
    }

    const save = async () => {
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            const credentials: NotificationChannelCredentials = {};
            for (const field of fields) {
                const value = draft[field.key];
                if (field.kind === 'boolean') {
                    credentials[field.key] = Boolean(value);
                    continue;
                }
                if (field.secret) {
                    if (typeof value === 'string' && value.trim() !== '') {
                        credentials[field.key] = value.trim();
                    }
                    continue;
                }
                if (field.kind === 'number') {
                    credentials[field.key] = value === '' || value === null || value === undefined
                        ? null
                        : Number(value);
                    continue;
                }
                credentials[field.key] = typeof value === 'string' ? value : value === null || value === undefined ? null : String(value);
            }

            await domainApi.updateNotificationChannel(channel.channel, { credentials });
            setDraft((current) => {
                const next = { ...current };
                for (const field of fields) {
                    if (field.kind !== 'boolean' && field.secret) {
                        next[field.key] = '';
                    }
                }
                return next;
            });
            setMessage('Identifiants enregistrés.');
            await onUpdated();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div class="grid gap-3 rounded-lg border border-base-300/70 p-3">
            <div>
                <h3 class="text-sm font-semibold">Identifiants du canal</h3>
                <p class="text-xs text-base-content/55">
                    Les secrets déjà configurés restent inchangés si le champ est laissé vide.
                </p>
            </div>
            <div class="grid gap-3">
                {fields.map((field) => {
                    const setFlag = Boolean(channel.credentials?.[`${field.key}_set`]);

                    if (field.kind === 'boolean') {
                        return (
                            <label class="flex items-center justify-between gap-3 text-sm" key={field.key}>
                                <span>{field.label}</span>
                                <input
                                    class="toggle toggle-sm"
                                    type="checkbox"
                                    checked={Boolean(draft[field.key])}
                                    disabled={!canManage || saving}
                                    onChange={(event) => setDraft((current) => ({
                                        ...current,
                                        [field.key]: event.currentTarget.checked,
                                    }))}
                                />
                            </label>
                        );
                    }

                    return (
                        <label class="grid gap-1 text-xs" key={field.key}>
                            <span>
                                {field.label}
                                {field.secret && setFlag ? ' · configuré' : ''}
                            </span>
                            <input
                                class="input input-bordered input-sm"
                                type={field.kind === 'number' ? 'number' : field.kind === 'password' ? 'password' : 'text'}
                                value={draft[field.key] === null || draft[field.key] === undefined ? '' : String(draft[field.key])}
                                placeholder={field.secret && setFlag ? 'Laisser vide pour conserver' : field.placeholder}
                                disabled={!canManage || saving}
                                autocomplete="off"
                                onInput={(event) => setDraft((current) => ({
                                    ...current,
                                    [field.key]: event.currentTarget.value,
                                }))}
                            />
                        </label>
                    );
                })}
            </div>
            {error && <p class="text-sm text-error">{error}</p>}
            {message && <p class="text-sm text-success">{message}</p>}
            {canManage && (
                <button class="btn btn-primary btn-sm w-fit" type="button" disabled={saving} onClick={() => void save()}>
                    <Save class="size-3.5" aria-hidden />
                    {saving ? 'Enregistrement…' : 'Enregistrer les identifiants'}
                </button>
            )}
        </div>
    );
}
