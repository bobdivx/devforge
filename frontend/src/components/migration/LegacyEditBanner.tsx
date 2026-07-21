import { Card } from '../ui/Card';

type LegacyEditBannerProps = {
    legacyBaseUrl: string;
    legacyPath: string;
    title?: string;
    description?: string;
};

export function LegacyEditBanner({
    title = 'Bientôt disponible',
    description = 'Cette fonctionnalité est en cours d\'intégration dans DevForge.',
}: Omit<LegacyEditBannerProps, 'legacyBaseUrl' | 'legacyPath'>) {
    return (
        <Card title={title} eyebrow="Fonctionnalité">
            <p class="text-sm text-base-content/65">{description}</p>
        </Card>
    );
}
