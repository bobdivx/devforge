import { ExternalLink } from 'lucide-preact';
import { Card } from '../ui/Card';
import { legacyCoolifyUrl } from '../../lib/migration';

type LegacyEditBannerProps = {
    legacyBaseUrl: string;
    legacyPath: string;
    title?: string;
    description?: string;
};

export function LegacyEditBanner({
    legacyBaseUrl,
    legacyPath,
    title = 'Édition dans DevForge',
    description = 'La modification de cette section est encore disponible dans l’interface DevForge d’origine.',
}: LegacyEditBannerProps) {
    return (
        <Card title={title} eyebrow="Migration en cours">
            <p class="text-sm text-base-content/65">{description}</p>
            <a
                class="btn btn-ghost btn-sm mt-3 w-fit rounded-xl"
                href={legacyCoolifyUrl(legacyBaseUrl, legacyPath)}
                target="_blank"
                rel="noreferrer"
            >
                <ExternalLink class="size-3.5" aria-hidden />
                Modifier dans DevForge
            </a>
        </Card>
    );
}
