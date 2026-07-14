import { RefreshCw } from 'lucide-preact';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { DataState } from '../components/ui/DataState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { LegacyEditBanner } from '../components/settings/SettingsPanels';
import { domainApi } from '../lib/domain-api';
import { parseSecuritySection } from '../lib/settings-tabs';
import { useApiQuery } from '../lib/use-api-query';

const sectionMeta = {
    keys: {
        title: 'Clés privées',
        legacyPath: '/security/private-key',
        description: 'Clés SSH et de déploiement accessibles à l’équipe active.',
    },
    'cloud-tokens': {
        title: 'Jetons cloud',
        legacyPath: '/security/cloud-tokens',
        description: 'Jetons des fournisseurs cloud pour le provisionnement.',
    },
    'cloud-init-scripts': {
        title: 'Scripts cloud-init',
        legacyPath: '/security/cloud-init-scripts',
        description: 'Scripts d’initialisation pour les nouveaux serveurs.',
    },
    'api-tokens': {
        title: 'Jetons API',
        legacyPath: '/security/api-tokens',
        description: 'Jetons d’accès API Sanctum pour l’automatisation.',
    },
} as const;

export function SecurityPage({
    embedded = false,
    path = '/settings/security',
    legacyBaseUrl = '',
}: {
    embedded?: boolean;
    path?: string;
    legacyBaseUrl?: string;
}) {
    const section = parseSecuritySection(path);
    const meta = sectionMeta[section];
    const query = useApiQuery(section === 'keys' ? 'security-keys' : null, () => domainApi.securityKeys());
    const keys = query.data?.data ?? [];

    if (section !== 'keys') {
        return (
            <>
                {!embedded && (
                    <PageHeader title={meta.title} description={meta.description} />
                )}
                <LegacyOnlySecuritySection meta={meta} legacyBaseUrl={legacyBaseUrl} />
            </>
        );
    }

    return (
        <>
            {!embedded && (
                <PageHeader
                    title="Sécurité"
                    description="Clés privées accessibles à l’équipe active."
                    actions={(
                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                            <RefreshCw class="size-3.5" aria-hidden />
                            Actualiser
                        </button>
                    )}
                />
            )}
            {embedded && (
                <div class="toolbar-row">
                    <p class="text-xs text-base-content/55">{meta.description}</p>
                    <div class="card-toolbar w-full sm:w-auto">
                        <button class="btn btn-ghost btn-sm w-full sm:w-auto" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                        </button>
                    </div>
                </div>
            )}
            <LegacyEditBanner legacyBaseUrl={legacyBaseUrl} legacyPath={meta.legacyPath} />
            <DataState loading={query.loading} error={query.error} empty={keys.length === 0} emptyMessage="Aucune clé privée." onRetry={() => void query.reload()}>
                <div class="grid gap-2 md:grid-cols-2">
                    {keys.map((key) => (
                        <Card title={key.name} eyebrow={key.is_git_related ? 'Git' : 'SSH'} key={key.uuid}>
                            <p class="text-xs text-base-content/55">{key.description || 'Sans description'}</p>
                            <div class="flex items-center justify-between gap-2">
                                <code class="truncate text-[11px] text-base-content/45">{key.fingerprint || 'Empreinte indisponible'}</code>
                                <StatusBadge label="Masquée" />
                            </div>
                        </Card>
                    ))}
                </div>
            </DataState>
        </>
    );
}

function LegacyOnlySecuritySection({
    meta,
    legacyBaseUrl,
}: {
    meta: (typeof sectionMeta)[keyof typeof sectionMeta];
    legacyBaseUrl: string;
}) {
    return (
        <div class="grid gap-4">
            <LegacyEditBanner legacyBaseUrl={legacyBaseUrl} legacyPath={meta.legacyPath} description={meta.description} />
            <Card title={meta.title}>
                <p class="text-sm text-base-content/65">
                    Cette section de sécurité est encore gérée dans Coolify.
                </p>
            </Card>
        </div>
    );
}
