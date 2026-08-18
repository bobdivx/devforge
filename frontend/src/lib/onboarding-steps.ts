export type OnboardingStepId = 'welcome' | 'domain' | 'sso' | 'github' | 's3' | 'server' | 'finish';

export type OnboardingSteps = {
    account: boolean;
    domain: boolean;
    sso: boolean;
    github: boolean;
    s3: boolean;
    server: boolean;
};

export const ONBOARDING_WIZARD_STEPS: Array<{
    id: OnboardingStepId;
    title: string;
    hint: string;
    optional: boolean;
}> = [
    { id: 'welcome', title: 'Compte', hint: 'Administrateur créé', optional: false },
    { id: 'domain', title: 'Domaine', hint: 'Domaine des applications', optional: false },
    { id: 'sso', title: 'SSO', hint: 'Pocket ID', optional: true },
    { id: 'github', title: 'GitHub', hint: 'Connexion puis dépôts', optional: true },
    { id: 's3', title: 'S3', hint: 'Sauvegardes objet', optional: true },
    { id: 'server', title: 'Serveur', hint: 'Hôte Docker', optional: false },
    { id: 'finish', title: 'Prêt', hint: 'Lancer DevForge', optional: false },
];

export function firstIncompleteStep(steps: OnboardingSteps, pick: string | null = null): OnboardingStepId {
    if (pick === 'repos') {
        return 'github';
    }

    if (!steps.domain) {
        return 'domain';
    }

    if (!steps.sso) {
        return 'sso';
    }

    if (!steps.github) {
        return 'github';
    }

    if (!steps.s3) {
        return 's3';
    }

    if (!steps.server) {
        return 'server';
    }

    return 'finish';
}

export function initialWizardStep(
    required: boolean,
    pick: string | null = null,
    steps: OnboardingSteps | null = null,
): OnboardingStepId {
    if (pick === 'repos') {
        return 'github';
    }

    if (pick === 'domain' || (steps !== null && !steps.domain)) {
        return 'domain';
    }

    if (!required) {
        return 'finish';
    }

    if (steps?.domain && steps.sso && steps.github && steps.s3 && steps.server) {
        return 'finish';
    }

    return 'welcome';
}

export type InstanceUrlMode = 'local' | 'custom';
export type AppsDomainMode = 'none' | 'custom';

export function isCustomInstanceUrl(url: string, origin: string): boolean {
    const normalized = normalizeInstanceUrl(url);
    const local = normalizeInstanceUrl(origin);

    return normalized !== '' && local !== '' && normalized !== local;
}

export function resolveOnboardingInstanceUrl(
    mode: InstanceUrlMode | null,
    customUrl: string,
    origin: string,
): string {
    if (mode === 'custom') {
        return normalizeInstanceUrl(customUrl);
    }

    if (mode === 'local') {
        return normalizeInstanceUrl(origin);
    }

    return '';
}

export function normalizeAppsWildcardDomain(value: string): string {
    let host = value.trim();
    if (host === '') {
        return '';
    }

    host = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '').replace(/^\*\./, '').toLowerCase();
    if (host === '' || !host.includes('.') || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) {
        return '';
    }

    const scheme = host.endsWith('.local') || host.includes('zimacube') || /^\d/.test(host)
        ? 'http'
        : 'https';

    return `${scheme}://${host}`;
}

export function applicationUrlSlug(name: string, fallback = 'app'): string {
    const slug = name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 63)
        .replace(/-+$/g, '');

    return slug === '' ? fallback : slug;
}

export function previewDefaultApplicationUrl(appName: string, wildcard: string): string {
    const normalized = normalizeAppsWildcardDomain(wildcard);
    if (normalized === '') {
        return '';
    }

    const scheme = normalized.startsWith('https://') ? 'https' : 'http';
    const host = normalized.replace(/^https?:\/\//, '');

    return `${scheme}://${applicationUrlSlug(appName)}.${host}`;
}

export function normalizeInstanceUrl(value: string, fallback = ''): string {
    let url = value.trim() || fallback.trim();
    if (url === '') {
        return '';
    }

    if (!/^https?:\/\//i.test(url)) {
        url = `http://${url}`;
    }

    return url.replace(/\/+$/, '');
}

export function submitGithubManifest(actionUrl: string, manifest: Record<string, unknown>): void {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = actionUrl;
    form.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'manifest';
    input.value = JSON.stringify(manifest);
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();
}
