import type { ComponentChildren } from 'preact';
import type { BootstrapData } from '../lib/bootstrap';
import { ErrorState } from './ui/ErrorState';
import { LoadingState } from './ui/LoadingState';

type AuthGuardProps = {
    loading: boolean;
    error: unknown;
    bootstrap: BootstrapData | null;
    onRetry: () => void;
    children: (bootstrap: BootstrapData) => ComponentChildren;
};

export function AuthGuard({ loading, error, bootstrap, onRetry, children }: AuthGuardProps) {
    if (loading) {
        return <LoadingState />;
    }

    if (error || !bootstrap) {
        return <ErrorState error={error} onRetry={onRetry} />;
    }

    return <>{children(bootstrap)}</>;
}
