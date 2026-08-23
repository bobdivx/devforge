import { useState } from 'preact/hooks';
import { OnboardingDomainStep } from '../../components/onboarding/OnboardingDomainStep';
import { OnboardingGithubStep } from '../../components/onboarding/OnboardingGithubStep';
import { OnboardingSsoStep } from '../../components/onboarding/OnboardingSsoStep';
import { OnboardingS3Step } from '../../components/onboarding/OnboardingS3Step';
import { OnboardingServerStep } from '../../components/onboarding/OnboardingServerStep';
import { OnboardingWizardProgress } from '../../components/onboarding/OnboardingWizardProgress';
import { RestartOnboardingButton } from '../../components/onboarding/RestartOnboardingButton';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { BootstrapData } from '../../lib/bootstrap';
import { domainApi } from '../../lib/domain-api';
import {
    initialWizardStep,
    ONBOARDING_WIZARD_STEPS,
    type OnboardingStepId,
} from '../../lib/onboarding-steps';
import { routeHref } from '../../lib/routes';

type OnboardingPageProps = {
    bootstrap: BootstrapData;
};

export function OnboardingPage({ bootstrap }: OnboardingPageProps) {
    const [current, setCurrent] = useState<OnboardingStepId>(() => {
        const params = new URLSearchParams(window.location.search);
        const pick = params.get('step') ?? params.get('pick');
        return initialWizardStep(bootstrap.onboarding.required, pick, bootstrap.onboarding.steps);
    });
    const [completing, setCompleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const canManage = bootstrap.permissions.create_resources;

    const goTo = (id: OnboardingStepId) => setCurrent(id);

    const nextAfter = (id: OnboardingStepId) => {
        const index = ONBOARDING_WIZARD_STEPS.findIndex((step) => step.id === id);
        goTo(ONBOARDING_WIZARD_STEPS[Math.min(index + 1, ONBOARDING_WIZARD_STEPS.length - 1)].id);
    };

    const backFrom = (id: OnboardingStepId) => {
        const index = ONBOARDING_WIZARD_STEPS.findIndex((step) => step.id === id);
        goTo(ONBOARDING_WIZARD_STEPS[Math.max(index - 1, 0)].id);
    };

    const finish = async () => {
        setCompleting(true);
        setError(null);
        try {
            await domainApi.completeOnboarding();
            window.location.assign(routeHref('/'));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Impossible de terminer l’onboarding.');
            setCompleting(false);
        }
    };

    return (
        <div class="mx-auto grid w-full max-w-3xl gap-3 sm:gap-4 md:gap-5">
            <PageHeader
                title="Assistant de configuration"
                description="Quelques questions pour préparer DevForge : URL d’accès, SSO Pocket ID, GitHub, sauvegardes, puis le serveur."
            />
            <OnboardingWizardProgress current={current} onSelect={goTo} />

            {current === 'welcome' && (
                <Card title={`Bienvenue, ${bootstrap.user.name}`} eyebrow="Compte administrateur">
                    <p class="text-sm text-base-content/65">
                        Le compte root est prêt. Un projet « Mon premier projet » et l’environnement production
                        sont créés automatiquement. Nous allons d’abord demander si vous avez une URL
                        personnalisée, puis le SSO Pocket ID, GitHub, S3 et le serveur Docker.
                    </p>
                    <p class="mt-2 text-sm text-base-content/55">
                        GitHub et S3 peuvent être passés. L’URL sert aux retours GitHub et aux applications.
                    </p>
                    <div class="mt-4">
                        <Button onClick={() => nextAfter('welcome')}>Commencer</Button>
                    </div>
                </Card>
            )}

            {current === 'domain' && (
                <OnboardingDomainStep
                    canEdit={bootstrap.permissions.instance_admin}
                    onBack={() => backFrom('domain')}
                    onSaved={() => nextAfter('domain')}
                />
            )}

            {current === 'sso' && (
                <OnboardingSsoStep
                    canEdit={bootstrap.permissions.instance_admin}
                    onSkip={() => nextAfter('sso')}
                    onContinue={() => nextAfter('sso')}
                    onBack={() => backFrom('sso')}
                />
            )}

            {current === 'github' && (
                <div class="grid gap-3">
                    <OnboardingGithubStep
                        canManage={canManage}
                        onSkip={() => nextAfter('github')}
                        onConnected={() => nextAfter('github')}
                    />
                    <Button variant="ghost" class="w-fit" onClick={() => backFrom('github')}>
                        Retour
                    </Button>
                </div>
            )}

            {current === 's3' && (
                <div class="grid gap-3">
                    <OnboardingS3Step
                        canManage={canManage}
                        onSkip={() => nextAfter('s3')}
                        onConnected={() => nextAfter('s3')}
                    />
                    <Button variant="ghost" class="w-fit" onClick={() => backFrom('s3')}>
                        Retour
                    </Button>
                </div>
            )}

            {current === 'server' && (
                <div class="grid gap-3">
                    <OnboardingServerStep onContinue={() => nextAfter('server')} />
                    <Button variant="ghost" class="w-fit" onClick={() => backFrom('server')}>
                        Retour
                    </Button>
                </div>
            )}

            {current === 'finish' && (
                <Card title="Vous êtes prêt" eyebrow="DevForge">
                    <div class="flex flex-wrap items-center gap-3">
                        <StatusBadge
                            label={bootstrap.onboarding.required ? 'Dernière étape' : 'Onboarding terminé'}
                            tone={bootstrap.onboarding.required ? 'warning' : 'success'}
                        />
                        <p class="text-sm text-base-content/65">
                            Un projet et l’environnement production sont déjà en place. Vous pourrez ajuster
                            l’URL, GitHub, S3 et les serveurs à tout moment dans les réglages.
                        </p>
                    </div>
                    {error && <p class="mt-3 text-xs text-error" role="alert">{error}</p>}
                    <div class="mt-4 flex flex-wrap items-center gap-2">
                        {bootstrap.onboarding.required ? (
                            <>
                                <Button variant="ghost" onClick={() => backFrom('finish')}>
                                    Retour
                                </Button>
                                <Button disabled={completing} onClick={() => void finish()}>
                                    {completing ? 'Ouverture…' : 'Entrer dans DevForge'}
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button onClick={() => window.location.assign(routeHref('/'))}>
                                    Retour à l’accueil
                                </Button>
                                {bootstrap.permissions.manage_team && (
                                    <RestartOnboardingButton variant="ghost" size="md" />
                                )}
                            </>
                        )}
                    </div>
                </Card>
            )}
        </div>
    );
}
