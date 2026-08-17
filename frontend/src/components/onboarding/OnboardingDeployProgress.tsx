import { Check, CircleAlert, LoaderCircle, Rocket } from 'lucide-preact';
import {
    onboardingDeployPipelineSteps,
    onboardingDeployProgress,
    overallPipelineIndex,
    phaseLabel,
    pipelineIndexForPhase,
    type OnboardingDeployItem,
    type OnboardingDeployPhase,
} from '../../lib/onboarding-deploy';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';
import { StatusBadge } from '../ui/StatusBadge';

type OnboardingDeployProgressProps = {
    items: OnboardingDeployItem[];
    onContinue: () => void;
};

const phaseTone: Record<OnboardingDeployPhase, 'success' | 'warning' | 'neutral' | 'error'> = {
    waiting: 'neutral',
    creating: 'warning',
    queued: 'warning',
    building: 'warning',
    healthy: 'success',
    failed: 'error',
};

export function OnboardingDeployProgress({ items, onContinue }: OnboardingDeployProgressProps) {
    const progress = onboardingDeployProgress(items);
    const pipeline = onboardingDeployPipelineSteps();
    const currentStep = overallPipelineIndex(items);

    return (
        <Card title="Déploiement des applications" eyebrow="En cours">
            <p class="text-sm text-base-content/65">
                Les applications sont créées puis déployées sur le serveur. Vous pouvez continuer le
                wizard : les builds poursuivent en arrière-plan.
            </p>

            <ol class="onboarding-deploy-pipeline mt-5 grid grid-cols-4 gap-2" aria-label="Étapes de déploiement">
                {pipeline.map((label, index) => {
                    const done = index < currentStep || (!progress.active && index <= currentStep);
                    const active = progress.active && index === currentStep;

                    return (
                        <li class="grid justify-items-center gap-2 text-center" key={label}>
                            <span
                                class={`grid size-8 place-items-center rounded-full text-xs font-semibold ${
                                    done
                                        ? 'bg-success/15 text-success'
                                        : active
                                            ? 'onboarding-deploy-node-active bg-primary text-primary-content'
                                            : 'bg-base-200 text-base-content/40'
                                }`}
                            >
                                {done ? <Check class="size-3.5" aria-hidden /> : index + 1}
                            </span>
                            <span class={`text-[11px] ${active ? 'font-semibold text-primary' : 'text-base-content/55'}`}>
                                {label}
                            </span>
                        </li>
                    );
                })}
            </ol>

            <div class="relative mt-3 h-1.5 overflow-hidden rounded-full bg-base-300">
                <div
                    class="h-full bg-primary/70 transition-all duration-500"
                    style={{ width: `${Math.max(8, (currentStep / Math.max(pipeline.length - 1, 1)) * 100)}%` }}
                />
                {progress.active && <span class="onboarding-deploy-shimmer" aria-hidden />}
            </div>

            <div class="mt-4">
                <ProgressBar
                    value={progress.completed + progress.failed}
                    max={Math.max(progress.total, 1)}
                    label={`${progress.completed}/${progress.total} en ligne`}
                    tone={progress.failed > 0 && !progress.active ? 'error' : 'primary'}
                />
            </div>

            <ul class="mt-4 grid gap-2">
                {items.map((item) => (
                    <li
                        class={`onboarding-deploy-app rounded-2xl border px-3 py-2.5 ${appRowClass(item.phase)}`}
                        key={item.repositoryId}
                    >
                        <div class="flex items-start gap-3">
                            <PhaseIcon phase={item.phase} />
                            <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <p class="truncate text-sm font-semibold">{item.fullName}</p>
                                    <StatusBadge label={phaseLabel(item.phase)} tone={phaseTone[item.phase]} />
                                </div>
                                {item.message && (
                                    <p class="mt-0.5 truncate text-xs text-base-content/55">{item.message}</p>
                                )}
                                <MiniTrack phase={item.phase} />
                            </div>
                        </div>
                    </li>
                ))}
            </ul>

            <div class="mt-4 flex flex-wrap gap-2">
                <Button disabled={!progress.canContinue} onClick={onContinue}>
                    {progress.active ? 'Continuer pendant le déploiement' : 'Continuer'}
                </Button>
            </div>
        </Card>
    );
}

function PhaseIcon({ phase }: { phase: OnboardingDeployPhase }) {
    if (phase === 'healthy') {
        return <Check class="mt-0.5 size-4 text-success" aria-hidden />;
    }

    if (phase === 'failed') {
        return <CircleAlert class="mt-0.5 size-4 text-error" aria-hidden />;
    }

    if (phase === 'waiting') {
        return <Rocket class="mt-0.5 size-4 text-base-content/35" aria-hidden />;
    }

    return <LoaderCircle class="mt-0.5 size-4 animate-spin text-primary" aria-hidden />;
}

function MiniTrack({ phase }: { phase: OnboardingDeployPhase }) {
    const index = pipelineIndexForPhase(phase);

    return (
        <div class="mt-2 flex gap-1" aria-hidden>
            {[0, 1, 2, 3].map((step) => (
                <span
                    key={step}
                    class={`h-1 flex-1 rounded-full ${
                        step < index
                            ? 'bg-success/70'
                            : step === index && phase !== 'failed' && phase !== 'healthy'
                                ? 'onboarding-deploy-track-active bg-primary'
                                : phase === 'failed' && step === index
                                    ? 'bg-error/70'
                                    : 'bg-base-300'
                    }`}
                />
            ))}
        </div>
    );
}

function appRowClass(phase: OnboardingDeployPhase): string {
    if (phase === 'healthy') {
        return 'border-success/25 bg-success/5';
    }

    if (phase === 'failed') {
        return 'border-error/30 bg-error/5';
    }

    if (phase === 'building' || phase === 'creating' || phase === 'queued') {
        return 'onboarding-deploy-app-active border-primary/30 bg-primary/5';
    }

    return 'border-base-300/70 bg-base-100';
}
