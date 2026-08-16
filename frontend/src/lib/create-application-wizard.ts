export type CreateApplicationWizardStep = 'source' | 'domain' | 'options';

export const CREATE_APPLICATION_WIZARD_STEPS: Array<{
    id: CreateApplicationWizardStep;
    title: string;
}> = [
    { id: 'source', title: 'Dépôt' },
    { id: 'domain', title: 'URL' },
    { id: 'options', title: 'Options' },
];

export type ApplicationUrlMode = 'auto' | 'custom';

export function normalizeApplicationUrl(value: string): string {
    let url = value.trim();
    if (url === '') {
        return '';
    }

    if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
    }

    return url.replace(/\/+$/, '');
}

export function resolveApplicationCustomDomain(mode: ApplicationUrlMode | null, customUrl: string): string | undefined {
    if (mode !== 'custom') {
        return undefined;
    }

    const normalized = normalizeApplicationUrl(customUrl);

    return normalized === '' ? undefined : normalized;
}
