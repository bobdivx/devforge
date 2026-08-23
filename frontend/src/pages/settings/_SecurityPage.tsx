import { PageHeader } from '../../components/PageHeader';
import { SecurityApiTokensPanel } from '../../components/security/SecurityApiTokensPanel';
import { SecurityCloudInitScriptsPanel } from '../../components/security/SecurityCloudInitScriptsPanel';
import { SecurityCloudTokensPanel } from '../../components/security/SecurityCloudTokensPanel';
import { SecurityPrivateKeysPanel } from '../../components/security/SecurityPrivateKeysPanel';
import { parseSecuritySection } from '../../lib/settings-tabs';
import { navigateTo } from '../../lib/use-navigate';

const sections = [
    { id: 'keys' as const, label: 'Clés privées', path: '/security/private-key' },
    { id: 'api-tokens' as const, label: 'API & MCP', path: '/security/api-tokens' },
    { id: 'cloud-tokens' as const, label: 'Providers cloud', path: '/security/cloud-tokens' },
    { id: 'cloud-init-scripts' as const, label: 'Cloud-init', path: '/security/cloud-init-scripts' },
] as const;

const sectionMeta = {
    keys: {
        title: 'Clés privées',
        description: 'Clés SSH et de déploiement accessibles à l’équipe active.',
    },
    'cloud-tokens': {
        title: 'Jetons providers cloud',
        description: 'Hetzner / DigitalOcean pour provisionner des serveurs — pas pour Cursor ni le MCP DevForge.',
    },
    'cloud-init-scripts': {
        title: 'Scripts cloud-init',
        description: 'Scripts d’initialisation pour les nouveaux serveurs (Hetzner).',
    },
    'api-tokens': {
        title: 'Jetons API & MCP',
        description: 'Jetons Sanctum pour l’API REST et le MCP DevForge (Cursor, agents).',
    },
} as const;

export function SecurityPage({
    embedded = false,
    path = '/settings/security',
}: {
    embedded?: boolean;
    path?: string;
}) {
    const section = parseSecuritySection(path);
    const meta = sectionMeta[section];

    const panel = (() => {
        switch (section) {
            case 'api-tokens':
                return <SecurityApiTokensPanel />;
            case 'cloud-tokens':
                return <SecurityCloudTokensPanel />;
            case 'cloud-init-scripts':
                return <SecurityCloudInitScriptsPanel />;
            default:
                return <SecurityPrivateKeysPanel />;
        }
    })();

    return (
        <div class="grid gap-2.5 sm:gap-3 md:gap-4">
            {!embedded && (
                <PageHeader title={meta.title} description={meta.description} />
            )}
            {embedded && (
                <div class="grid gap-1">
                    <h2 class="text-lg font-semibold">{meta.title}</h2>
                    <p class="text-sm text-base-content/60">{meta.description}</p>
                </div>
            )}
            <nav aria-label="Sections sécurité" class="flex flex-wrap gap-1 rounded-full border border-base-300/70 bg-base-200/60 p-1">
                {sections.map((item) => {
                    const selected = item.id === section;

                    return (
                        <button
                            key={item.id}
                            class={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                                selected
                                    ? 'bg-base-100 font-semibold text-primary shadow-sm ring-1 ring-primary/15'
                                    : 'text-base-content/55 hover:bg-base-100/70 hover:text-base-content'
                            }`}
                            type="button"
                            aria-current={selected ? 'page' : undefined}
                            onClick={() => navigateTo(item.path)}
                        >
                            {item.label}
                        </button>
                    );
                })}
            </nav>
            {panel}
        </div>
    );
}
