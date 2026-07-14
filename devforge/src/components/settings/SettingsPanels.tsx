import { ExternalLink } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
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
    title = 'Édition dans Coolify',
    description = 'La modification de cette section est encore disponible dans l’interface Coolify d’origine.',
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
                Modifier dans Coolify
            </a>
        </Card>
    );
}

type SettingsDetailListProps = {
    items: Array<{ label: string; value: ComponentChildren }>;
};

export function SettingsDetailList({ items }: SettingsDetailListProps) {
    return (
        <dl class="grid gap-3">
            {items.map(({ label, value }) => (
                <div
                    class="grid gap-1 border-b border-base-300/50 pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(9rem,11rem)_minmax(0,1fr)] sm:items-start sm:gap-4"
                    key={label}
                >
                    <dt class="text-xs font-medium text-base-content/45 sm:text-sm">{label}</dt>
                    <dd class="min-w-0 break-words text-sm">{value}</dd>
                </div>
            ))}
        </dl>
    );
}

export function formatBoolean(value: boolean): string {
    return value ? 'Oui' : 'Non';
}

export function formatOptional(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === '') {
        return '—';
    }

    return String(value);
}

export function formatSecretConfigured(configured: boolean | '********' | string | null): string {
    if (configured === '********' || configured === true || (typeof configured === 'string' && configured.length > 0)) {
        return 'Configuré';
    }

    return 'Non défini';
}
