import type { ServerCleanupPhase } from '../../lib/server-cleanup-tracker';
import type { ServerStorageExecution } from '../../lib/domain-api';

type Props = {
    phase: ServerCleanupPhase;
    phaseLabel: string;
    execution: ServerStorageExecution | null;
};

export function CleanupProgressPanel({ phase, phaseLabel, execution }: Props) {
    const tone = phase === 'failed' ? 'error' : phase === 'completed' ? 'success' : 'warning';

    return (
        <div
            class={`rounded-xl border px-4 py-3 ${
                tone === 'error'
                    ? 'border-error/30 bg-error/10'
                    : tone === 'success'
                        ? 'border-success/30 bg-success/10'
                        : 'border-warning/30 bg-warning/10'
            }`}
            role="status"
            aria-live="polite"
            aria-busy={phase === 'queued' || phase === 'running'}
        >
            <div class="flex items-start gap-3">
                {(phase === 'queued' || phase === 'running') && (
                    <span class={`loading loading-spinner loading-sm shrink-0 ${tone === 'warning' ? 'text-warning' : ''}`} aria-hidden />
                )}
                <div class="min-w-0 flex-1 space-y-2">
                    <p class={`text-sm font-medium ${
                        tone === 'error' ? 'text-error' : tone === 'success' ? 'text-success' : 'text-warning'
                    }`}
                    >
                        {phaseLabel}
                    </p>

                    {(phase === 'queued' || phase === 'running') && (
                        <div class="relative h-1.5 overflow-hidden rounded-full bg-base-content/10">
                            <div class="cleanup-progress-bar absolute inset-y-0 w-1/3 rounded-full bg-warning" />
                        </div>
                    )}

                    {execution?.message && (
                        <p class="text-xs text-base-content/65">{execution.message}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
