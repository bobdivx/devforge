import type { ComponentChildren } from 'preact';

export { LegacyEditBanner } from '../migration/LegacyEditBanner';

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
