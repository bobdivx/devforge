import { ArrowUpCircle, Loader2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { ApiError } from '../lib/api-client';
import {
    instanceUpgradeLabel,
    instanceUpgradeProgressPercent,
    shouldShowInstanceUpgrade,
} from '../lib/instance-upgrade';
import { useInstanceUpgrade } from '../lib/use-instance-upgrade';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { ProgressBar } from './ui/ProgressBar';

type InstanceUpdateIndicatorProps = {
    enabled: boolean;
};

export function InstanceUpdateIndicator({ enabled }: InstanceUpdateIndicatorProps) {
    const { status, starting, error, start } = useInstanceUpgrade({ enabled });
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmError, setConfirmError] = useState<string | null>(null);

    if (!shouldShowInstanceUpgrade(status) || !status) {
        return null;
    }

    const inProgress = status.status === 'in_progress' || starting;
    const canLaunch = status.available && (status.status === 'none' || status.status === 'error') && !starting;
    const label = instanceUpgradeLabel(status);

    const handleConfirm = async () => {
        setConfirmError(null);
        try {
            await start();
            setConfirmOpen(false);
        } catch (caught) {
            setConfirmError(caught instanceof ApiError ? caught.message : 'Impossible de lancer la mise à jour.');
        }
    };

    return (
        <>
            <button
                type="button"
                class={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    status.status === 'error'
                        ? 'border-error/30 bg-error/10 text-error hover:bg-error/15'
                        : 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/15'
                }`}
                aria-label={label}
                aria-live="polite"
                disabled={!canLaunch}
                onClick={() => {
                    if (!canLaunch) {
                        return;
                    }
                    setConfirmError(null);
                    setConfirmOpen(true);
                }}
            >
                {inProgress ? (
                    <Loader2 class="size-3.5 animate-spin" aria-hidden />
                ) : (
                    <ArrowUpCircle class="size-3.5" aria-hidden />
                )}
                <span class="max-w-[12rem] truncate">{label}</span>
            </button>

            {(inProgress || status.status === 'complete') && status.message && (
                <span class="sr-only">{status.message}</span>
            )}

            <ConfirmDialog
                open={confirmOpen}
                title="Mettre à jour DevForge ?"
                message={(
                    <>
                        <p>
                            La version {status.current_version} va être mise à jour vers {status.latest_version}.
                            L’interface sera indisponible pendant le redémarrage.
                        </p>
                        {inProgress && (
                            <ProgressBar
                                value={instanceUpgradeProgressPercent(status)}
                                tone="warning"
                                active={status.status === 'in_progress'}
                                label={status.message ?? 'Mise à jour'}
                            />
                        )}
                        {(confirmError || error) && (
                            <p class="text-error">{confirmError ?? error}</p>
                        )}
                    </>
                )}
                confirmLabel="Mettre à jour maintenant"
                cancelLabel="Plus tard"
                tone="primary"
                loading={starting}
                onConfirm={() => void handleConfirm()}
                onCancel={() => setConfirmOpen(false)}
            />
        </>
    );
}
