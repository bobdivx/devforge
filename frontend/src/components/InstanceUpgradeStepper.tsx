import { Check, Loader2 } from 'lucide-preact';
import { INSTANCE_UPGRADE_UI_STEPS } from '../lib/instance-upgrade';

type InstanceUpgradeStepperProps = {
    currentStep: number;
};

export function InstanceUpgradeStepper({ currentStep }: InstanceUpgradeStepperProps) {
    return (
        <ol class="flex w-full items-start justify-between" aria-label="Étapes de mise à jour">
            {INSTANCE_UPGRADE_UI_STEPS.map((step, index) => {
                const state = currentStep > step.id ? 'done' : currentStep === step.id ? 'current' : 'pending';
                const last = index === INSTANCE_UPGRADE_UI_STEPS.length - 1;

                return (
                    <li class={`flex items-center ${last ? '' : 'min-w-0 flex-1'}`} key={step.id}>
                        <div class="flex flex-col items-center text-center">
                            <div
                                class={`grid size-7 sm:size-8 shrink-0 place-items-center rounded-full border-2 transition-colors ${
                                    state === 'done'
                                        ? 'border-success bg-success text-success-content'
                                        : state === 'current'
                                            ? 'border-warning bg-warning/15 text-warning'
                                            : 'border-base-300 text-base-content/40'
                                }`}
                            >
                                {state === 'done' && <Check class="size-3.5 sm:size-4" aria-hidden />}
                                {state === 'current' && <Loader2 class="size-3 sm:size-3.5 animate-spin" aria-hidden />}
                                {state === 'pending' && <span class="text-[11px] sm:text-xs font-semibold">{step.id}</span>}
                            </div>
                            <span
                                class={`mt-1 max-w-[3.8rem] sm:max-w-none truncate text-[9px] sm:text-[11px] font-medium leading-tight ${
                                    state === 'done'
                                        ? 'text-success'
                                        : state === 'current'
                                            ? 'text-warning'
                                            : 'text-base-content/40'
                                }`}
                                title={step.label}
                            >
                                {step.label}
                            </span>
                        </div>
                        {!last && (
                            <div
                                class={`mx-1 sm:mx-2.5 -mt-3.5 sm:-mt-4 h-0.5 min-w-2 sm:min-w-4 flex-1 rounded-full ${
                                    state === 'done' ? 'bg-success' : 'bg-base-300'
                                }`}
                                aria-hidden
                            />
                        )}
                    </li>
                );
            })}
        </ol>
    );
}
