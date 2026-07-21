import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/ui/Card';
import { LegacyEditBanner } from '../../components/migration/LegacyEditBanner';
import { SecurityApiTokensPanel } from '../../components/security/SecurityApiTokensPanel';
import { SecurityCloudTokensPanel } from '../../components/security/SecurityCloudTokensPanel';
import { SecurityPrivateKeysPanel } from '../../components/security/SecurityPrivateKeysPanel';
import { parseSecuritySection } from '../../lib/settings-tabs';

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

    if (section === 'keys') {
        return (
            <>
                {!embedded && (
                    <PageHeader
                        title="Sécurité"
                        description="Clés privées accessibles à l’équipe active."
                    />
                )}
                <SecurityPrivateKeysPanel />
            </>
        );
    }

    if (section === 'api-tokens') {
        return (
            <>
                {!embedded && (
                    <PageHeader title={meta.title} description={meta.description} />
                )}
                <SecurityApiTokensPanel />
            </>
        );
    }

    if (section === 'cloud-tokens') {
        return (
            <>
                {!embedded && (
                    <PageHeader title={meta.title} description={meta.description} />
                )}
                <SecurityCloudTokensPanel />
            </>
        );
    }

    return (
        <>
            {!embedded && (
                <PageHeader title={meta.title} description={meta.description} />
            )}
            <LegacyOnlySecuritySection meta={meta} legacyBaseUrl={legacyBaseUrl} />
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
