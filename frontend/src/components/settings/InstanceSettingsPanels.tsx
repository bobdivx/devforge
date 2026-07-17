import { RefreshCw } from 'lucide-preact';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { LegacyEditBanner } from '../migration/LegacyEditBanner';
import {
    formatBoolean,
    formatOptional,
    formatSecretConfigured,
    SettingsDetailList,
} from './SettingsPanels';
import type { BootstrapPermissions } from '../../lib/bootstrap';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type InstanceSettingsPanelsProps = {
    section: 'instance' | 'advanced' | 'email' | 'updates';
    permissions: BootstrapPermissions;
    legacyBaseUrl: string;
};

const legacyPaths: Record<InstanceSettingsPanelsProps['section'], string> = {
    instance: '/settings',
    advanced: '/settings/advanced',
    email: '/settings/email',
    updates: '/settings/updates',
};

const titles: Record<InstanceSettingsPanelsProps['section'], string> = {
    instance: 'Instance',
    advanced: 'Paramètres avancés',
    email: 'E-mail transactionnel',
    updates: 'Mises à jour',
};

export function InstanceSettingsPanels({ section, permissions, legacyBaseUrl }: InstanceSettingsPanelsProps) {
    const settings = useApiQuery('settings', () => domainApi.settings());
    const data = settings.data?.data;

    const sectionItems = (() => {
        if (!data) {
            return [];
        }

        if (section === 'instance') {
            const instance = data.instance;
            return [
                { label: 'Nom', value: formatOptional(instance.instance_name) },
                {
                    label: 'URL instance',
                    value: formatOptional(instance.fqdn),
                },
                { label: 'Fuseau', value: formatOptional(instance.instance_timezone) },
                { label: 'IPv4 publique', value: formatOptional(instance.public_ipv4) },
                { label: 'IPv6 publique', value: formatOptional(instance.public_ipv6) },
                { label: 'Ports publics', value: `${formatOptional(instance.public_port_min)} → ${formatOptional(instance.public_port_max)}` },
                { label: 'Canal', value: formatOptional(instance.next_channel) },
                { label: 'Version helper', value: formatOptional(instance.helper_version) },
            ];
        }

        if (section === 'advanced') {
            const advanced = data.advanced;
            return [
                { label: 'Inscriptions', value: formatBoolean(advanced.is_registration_enabled) },
                { label: 'Ne pas suivre', value: formatBoolean(advanced.do_not_track) },
                { label: 'Validation DNS', value: formatBoolean(advanced.is_dns_validation_enabled) },
                { label: 'Serveurs DNS', value: formatOptional(advanced.custom_dns_servers) },
                { label: 'API', value: formatBoolean(advanced.is_api_enabled) },
                { label: 'IP autorisées', value: formatOptional(advanced.allowed_ips) },
                { label: 'Popup sponsoring', value: formatBoolean(advanced.is_sponsorship_popup_enabled) },
                { label: 'Confirmation en 2 étapes', value: advanced.disable_two_step_confirmation ? 'Désactivée' : 'Activée' },
                { label: 'Navigation wire', value: formatBoolean(advanced.is_wire_navigate_enabled) },
                { label: 'Serveur MCP', value: formatBoolean(advanced.is_mcp_server_enabled) },
            ];
        }

        if (section === 'email') {
            const email = data.email;
            return [
                { label: 'SMTP', value: <StatusBadge label={email.smtp_enabled ? 'Activé' : 'Désactivé'} tone={email.smtp_enabled ? 'success' : 'neutral'} /> },
                { label: 'Expéditeur', value: formatSecretConfigured(email.smtp_from_address) },
                { label: 'Nom expéditeur', value: formatSecretConfigured(email.smtp_from_name) },
                { label: 'Destinataires', value: formatSecretConfigured(email.smtp_recipients) },
                { label: 'Hôte SMTP', value: formatSecretConfigured(email.smtp_host) },
                { label: 'Port', value: formatOptional(email.smtp_port) },
                { label: 'Chiffrement', value: formatOptional(email.smtp_encryption) },
                { label: 'Utilisateur', value: formatSecretConfigured(email.smtp_username) },
                { label: 'Mot de passe', value: formatSecretConfigured(email.smtp_password) },
                { label: 'Resend', value: formatBoolean(email.resend_enabled) },
                { label: 'Clé Resend', value: formatSecretConfigured(email.resend_api_key) },
            ];
        }

        const updates = data.updates;
        return [
            { label: 'Mises à jour auto', value: formatBoolean(updates.is_auto_update_enabled) },
            { label: 'Fréquence auto', value: formatOptional(updates.auto_update_frequency) },
            { label: 'Vérification', value: formatOptional(updates.update_check_frequency) },
            { label: 'Nouvelle version', value: formatBoolean(updates.new_version_available) },
        ];
    })();

    return (
        <div class="grid gap-4">
            <LegacyEditBanner legacyBaseUrl={legacyBaseUrl} legacyPath={legacyPaths[section]} />
            <Card title={titles[section]} eyebrow={permissions.instance_admin ? 'Administrateur' : 'Lecture seule'}>
                <div class="card-toolbar mb-3">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void settings.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </div>
                <DataState loading={settings.loading} error={settings.error} onRetry={() => void settings.reload()}>
                    {data && (
                        <div class="grid gap-3">
                            <SettingsDetailList items={sectionItems} />
                            {section === 'instance' && (
                                <p class="text-xs text-base-content/55">
                                    L’URL instance est celle de Coolify/DevForge. Le domaine des apps déployées se configure
                                    via le <span class="font-medium">Wildcard Domain</span> sur chaque serveur
                                    (Settings → Serveurs → Vue d’ensemble).
                                </p>
                            )}
                        </div>
                    )}
                </DataState>
            </Card>
        </div>
    );
}

export function OauthSettingsPanel({ permissions, legacyBaseUrl }: { permissions: BootstrapPermissions; legacyBaseUrl: string }) {
    const oauth = useApiQuery('settings-oauth', () => domainApi.oauthSettings());

    return (
        <div class="grid gap-4">
            <LegacyEditBanner legacyBaseUrl={legacyBaseUrl} legacyPath="/settings/oauth" />
            <Card title="OAuth" eyebrow={permissions.instance_admin ? 'Administrateur' : 'Lecture seule'}>
                <DataState loading={oauth.loading} error={oauth.error} onRetry={() => void oauth.reload()}>
                    {oauth.data && (
                        <div class="grid gap-3">
                            {oauth.data.data.length === 0 ? (
                                <p class="text-sm text-base-content/55">Aucun fournisseur OAuth configuré.</p>
                            ) : (
                                oauth.data.data.map((provider) => (
                                    <div class="rounded-xl border border-base-300/70 p-4" key={provider.id}>
                                        <div class="mb-2 flex items-center justify-between gap-2">
                                            <p class="text-sm font-semibold capitalize">{provider.provider}</p>
                                            <StatusBadge label={provider.enabled ? 'Activé' : 'Désactivé'} tone={provider.enabled ? 'success' : 'neutral'} />
                                        </div>
                                        <SettingsDetailList items={[
                                            { label: 'Client ID', value: formatSecretConfigured(provider.client_id) },
                                            { label: 'Secret', value: formatSecretConfigured(provider.client_secret) },
                                            { label: 'Redirect URI', value: formatOptional(provider.redirect_uri) },
                                            { label: 'Tenant', value: formatOptional(provider.tenant) },
                                            { label: 'Base URL', value: formatOptional(provider.base_url) },
                                        ]}
                                        />
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </DataState>
            </Card>
        </div>
    );
}

export function LegacyOnlySettingsPanel({
    title,
    description,
    legacyPath,
    legacyBaseUrl,
}: {
    title: string;
    description: string;
    legacyPath: string;
    legacyBaseUrl: string;
}) {
    return (
        <div class="grid gap-4">
            <LegacyEditBanner
                legacyBaseUrl={legacyBaseUrl}
                legacyPath={legacyPath}
                title={title}
                description={description}
            />
            <Card title={title}>
                <p class="text-sm text-base-content/65">
                    Cette section n’est pas encore entièrement disponible dans DevForge. Utilisez Coolify pour la configuration complète.
                </p>
            </Card>
        </div>
    );
}
