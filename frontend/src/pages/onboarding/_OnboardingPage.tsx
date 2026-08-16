import { CheckCircle2, Circle } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import { OnboardingGithubStep } from '../../components/onboarding/OnboardingGithubStep';
import { OnboardingS3Step } from '../../components/onboarding/OnboardingS3Step';
import { OnboardingServerStep } from '../../components/onboarding/OnboardingServerStep';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { BootstrapData } from '../../lib/bootstrap';
import { domainApi } from '../../lib/domain-api';
import {
    firstIncompleteStep,
    ONBOARDING_WIZARD_STEPS,
    type OnboardingStepId,
} from '../../lib/onboarding-steps';
import { routeHref } from '../../lib/routes';

type OnboardingPageProps = {
    bootstrap: BootstrapData;
};

export function OnboardingPage({ bootstrap }: OnboardingPageProps) {
    const steps = bootstrap.onboarding.steps ?? {
        account: true,
        github: false,
        s3: false,
        server: false,
    };
    const [current, setCurrent] = useState<OnboardingStepId>(() => {
        const pick = new URLSearchParams(window.location.search).get('pick');
        return bootstrap.onboarding.required ? firstIncompleteStep(steps, pick) : 'finish';
    });
    const [completing, setCompleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const canManage = bootstrap.permissions.create_resources;

    const currentIndex = useMemo(
        () => ONBOARDING_WIZARD_STEPS.findIndex((step) => step.id === current),
        [current],
    );

    const goTo = (id: OnboardingStepId) => setCurrent(id);

    const nextAfter = (id: OnboardingStepId) => {
        const index = ONBOARDING_WIZARD_STEPS.findIndex((step) => step.id === id);
        goTo(ONBOARDING_WIZARD_STEPS[Math.min(index + 1, ONBOARDING_WIZARD_STEPS.length - 1)].id);
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
        <div class="grid gap-5">
            <PageHeader
                title="Configuration initiale"
                description="Connectez GitHub, un stockage S3 et confirmez votre premier serveur."
            />
            <ol class="grid gap-2 sm:grid-cols-5">
                {ONBOARDING_WIZARD_STEPS.map((step, index) => {
                    const done = index < currentIndex
                        || (step.id === 'welcome' && steps.account)
                        || (step.id === 'github' && steps.github)
                        || (step.id === 's3' && steps.s3)
                        || (step.id === 'server' && steps.server);
                    const active = step.id === current;
                    const Icon = done && !active ? CheckCircle2 : Circle;

                    return (
                        <li key={step.id}>
                            <button
                                class={`w-full rounded-2xl border p-3 text-left transition ${
                                    active
                                        ? 'border-primary/40 bg-primary/5 shadow-sm'
                                        : 'border-base-300/70 bg-base-100'
                                }`}
                                type="button"
                                onClick={() => goTo(step.id)}
                            >
                                <div class="flex items-center gap-2">
                                    <Icon class={`size-4 ${done ? 'text-success' : 'text-base-content/35'}`} aria-hidden />
                                    <span class="text-sm font-semibold">{index + 1}. {step.title}</span>
                                </div>
                                <p class="mt-1 text-[11px] text-base-content/50">{step.hint}</p>
                            </button>
                        </li>
                    );
                })}
            </ol>

            {current === 'welcome' && (
                <Card title={`Bienvenue, ${bootstrap.user.name}`} eyebrow="Compte administrateur">
                    <p class="text-sm text-base-content/65">
                        Le compte root est créé. Ensuite : un clic pour GitHub, choix des dépôts à démarrer, S3, puis
                        le serveur Docker.
                    </p>
                    <p class="mt-2 text-sm text-base-content/55">
                        GitHub et S3 peuvent être passés et configurés plus tard.
                    </p>
                    <div class="mt-4">
                        <Button onClick={() => goTo('github')}>Commencer</Button>
                    </div>
                </Card>
            )}

            {current === 'github' && (
                <OnboardingGithubStep
                    canManage={canManage}
                    onSkip={() => nextAfter('github')}
                    onConnected={() => nextAfter('github')}
                />
            )}

            {current === 's3' && (
                <OnboardingS3Step
                    canManage={canManage}
                    onSkip={() => nextAfter('s3')}
                    onConnected={() => nextAfter('s3')}
                />
            )}

            {current === 'server' && (
                <OnboardingServerStep onContinue={() => nextAfter('server')} />
            )}

            {current === 'finish' && (
                <Card title="Vous êtes prêt" eyebrow="DevForge">
                    <div class="flex flex-wrap items-center gap-3">
                        <StatusBadge
                            label={bootstrap.onboarding.required ? 'Dernière étape' : 'Onboarding terminé'}
                            tone={bootstrap.onboarding.required ? 'warning' : 'success'}
                        />
                        <p class="text-sm text-base-content/65">
                            Vous pourrez ajuster GitHub, S3 et les serveurs à tout moment dans les réglages.
                        </p>
                    </div>
                    {error && <p class="mt-3 text-xs text-error" role="alert">{error}</p>}
                    <div class="mt-4 flex flex-wrap gap-2">
                        <Button disabled={completing} onClick={() => void finish()}>
                            {completing ? 'Ouverture…' : 'Entrer dans DevForge'}
                        </Button>
                    </div>
                </Card>
            )}
        </div>
    );
}
