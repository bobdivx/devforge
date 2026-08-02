import { Loader2, Rocket } from 'lucide-preact';
import type { ApplicationBootSequence } from '../../lib/domain-api';
import { ProgressBar } from '../ui/ProgressBar';

type ApplicationBootSequenceBannerProps = {
    sequence: ApplicationBootSequence;
};

export function ApplicationBootSequenceBanner({ sequence }: ApplicationBootSequenceBannerProps) {
    if (!sequence.active || sequence.total === 0) {
        return null;
    }

    const current = sequence.items.find((item) => item.uuid === sequence.current_uuid)
        ?? sequence.items.find((item) => item.phase === 'starting');

    return (
        <article
            class="application-boot-banner mb-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 shadow-sm"
            role="status"
            aria-live="polite"
            aria-busy="true"
        >
            <div class="mb-3 flex items-start gap-3">
                <div class="rounded-lg bg-primary/10 p-2 text-primary">
                    <Rocket class="size-4" aria-hidden />
                </div>
                <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-base-content">
                        Démarrage des applications
                    </p>
                    <p class="text-xs text-base-content/60">
                        {sequence.completed}/{sequence.total} prêtes
                        {current ? ` — ${current.name}` : ''}
                    </p>
                </div>
                <Loader2 class="size-4 shrink-0 animate-spin text-primary" aria-hidden />
            </div>
            <ProgressBar value={sequence.completed} max={sequence.total} tone="primary" />
        </article>
    );
}
