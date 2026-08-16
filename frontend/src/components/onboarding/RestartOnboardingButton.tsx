import { RotateCcw } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { domainApi } from '../../lib/domain-api';
import { routeHref } from '../../lib/routes';
import { Button } from '../ui/Button';

type RestartOnboardingButtonProps = {
    variant?: 'primary' | 'ghost';
    size?: 'sm' | 'md';
};

export function RestartOnboardingButton({ variant = 'ghost', size = 'sm' }: RestartOnboardingButtonProps) {
    const [restarting, setRestarting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const restart = async () => {
        setRestarting(true);
        setError(null);
        try {
            await domainApi.restartOnboarding();
            window.location.assign(routeHref('/onboarding'));
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Impossible de relancer l’assistant.');
            setRestarting(false);
        }
    };

    return (
        <div class="grid gap-2">
            <Button variant={variant} size={size} disabled={restarting} onClick={() => void restart()}>
                <RotateCcw class="size-3.5" aria-hidden />
                {restarting ? 'Ouverture…' : 'Relancer l’assistant'}
            </Button>
            {error && <p class="text-xs text-error" role="alert">{error}</p>}
        </div>
    );
}
