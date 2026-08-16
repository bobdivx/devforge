export type OnboardingStepId = 'welcome' | 'github' | 's3' | 'server' | 'finish';

export type OnboardingSteps = {
    account: boolean;
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
    { id: 'github', title: 'GitHub', hint: 'Connexion puis dépôts', optional: true },
    { id: 's3', title: 'S3', hint: 'Sauvegardes objet', optional: true },
    { id: 'server', title: 'Serveur', hint: 'Hôte Docker', optional: false },
    { id: 'finish', title: 'Prêt', hint: 'Lancer DevForge', optional: false },
];

export function firstIncompleteStep(steps: OnboardingSteps, pick: string | null = null): OnboardingStepId {
    if (!steps.github || pick === 'repos') {
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
