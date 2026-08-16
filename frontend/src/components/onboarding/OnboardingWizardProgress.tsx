import { Check } from 'lucide-preact';
import { ONBOARDING_WIZARD_STEPS, type OnboardingStepId } from '../../lib/onboarding-steps';

type OnboardingWizardProgressProps = {
    current: OnboardingStepId;
    onSelect: (id: OnboardingStepId) => void;
};

export function OnboardingWizardProgress({ current, onSelect }: OnboardingWizardProgressProps) {
    const currentIndex = ONBOARDING_WIZARD_STEPS.findIndex((step) => step.id === current);

    return (
        <div class="grid gap-3">
            <p class="text-sm text-base-content/55">
                Étape {currentIndex + 1} sur {ONBOARDING_WIZARD_STEPS.length}
                {' · '}
                {ONBOARDING_WIZARD_STEPS[currentIndex]?.title}
            </p>
            <ol class="flex items-center gap-1">
                {ONBOARDING_WIZARD_STEPS.map((step, index) => {
                    const done = index < currentIndex;
                    const active = step.id === current;
                    const reachable = index <= currentIndex;

                    return (
                        <li class="flex min-w-0 flex-1 items-center gap-1" key={step.id}>
                            <button
                                class={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold transition ${
                                    active
                                        ? 'bg-primary text-primary-content'
                                        : done
                                            ? 'bg-success/15 text-success'
                                            : 'bg-base-200 text-base-content/40'
                                } ${reachable ? '' : 'cursor-default'}`}
                                type="button"
                                disabled={!reachable}
                                aria-current={active ? 'step' : undefined}
                                aria-label={`${index + 1}. ${step.title}`}
                                onClick={() => {
                                    if (reachable) {
                                        onSelect(step.id);
                                    }
                                }}
                            >
                                {done ? <Check class="size-3.5" aria-hidden /> : index + 1}
                            </button>
                            {index < ONBOARDING_WIZARD_STEPS.length - 1 && (
                                <span
                                    class={`h-px min-w-2 flex-1 ${done ? 'bg-success/40' : 'bg-base-300'}`}
                                    aria-hidden
                                />
                            )}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
