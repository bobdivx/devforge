import { AlertTriangle, ArrowUpCircle, CheckCircle2, Loader2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError } from '../lib/api-client';
import {
    formatInstanceUpgradeElapsed,
    instanceUpgradeLabel,
    instanceUpgradeProgressPercent,
    shouldShowInstanceUpgrade,
} from '../lib/instance-upgrade';
import { useInstanceUpgrade } from '../lib/use-instance-upgrade';
import { InstanceUpgradeStepper } from './InstanceUpgradeStepper';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { ProgressBar } from './ui/ProgressBar';

type InstanceUpdateIndicatorProps = {
    enabled: boolean;
    onReload?: () => void;
    checkHealth?: () => Promise<boolean>;
};

export function InstanceUpdateIndicator({ enabled, onReload, checkHealth }: InstanceUpdateIndicatorProps) {
    const {
        status,
        starting,
        error,
        start,
        phase,
        message,
        uiStep,
        elapsedSeconds,
        successCountdown,
        reloadNow,
    } = useInstanceUpgrade({ enabled, onReload, checkHealth });
    const [modalOpen, setModalOpen] = useState(false);
    const [confirmError, setConfirmError] = useState<string | null>(null);

    const locked = phase === 'progress' || phase === 'reviving' || phase === 'complete';

    useEffect(() => {
        if (locked) {
            setModalOpen(true);
        }
    }, [locked]);

    if (!shouldShowInstanceUpgrade(status) || !status) {
        return null;
    }

    const canLaunch = status.available && (status.status === 'none' || status.status === 'error') && !starting && !locked;
    const badgeLabel = phase === 'reviving' || phase === 'complete'
        ? 'Redémarrage…'
        : starting || phase === 'progress'
            ? 'Mise à jour…'
            : instanceUpgradeLabel(status);

    const modalTitle = phase === 'complete'
        ? 'Mise à jour terminée'
        : phase === 'error'
            ? 'Échec de la mise à jour'
            : locked
                ? 'Mise à jour en cours…'
                : 'Mettre à jour DevForge ?';

    const handleConfirm = async () => {
        setConfirmError(null);
        try {
            await start();
        } catch (caught) {
            setConfirmError(caught instanceof ApiError ? caught.message : 'Impossible de lancer la mise à jour.');
        }
    };

    const handleClose = () => {
        if (locked) {
            return;
        }

        setModalOpen(false);
        setConfirmError(null);
    };

    return (
        <>
            <button
                type="button"
                class={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    status.status === 'error' && phase !== 'progress'
                        ? 'border-error/30 bg-error/10 text-error hover:bg-error/15'
                        : 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/15'
                }`}
                aria-label={badgeLabel}
                aria-live="polite"
                disabled={!canLaunch && !locked && phase !== 'error'}
                onClick={() => {
                    setConfirmError(null);
                    setModalOpen(true);
                }}
            >
                {locked && phase !== 'complete' ? (
                    <Loader2 class="size-3.5 animate-spin" aria-hidden />
                ) : (
                    <ArrowUpCircle class="size-3.5" aria-hidden />
                )}
                <span class="max-w-[12rem] truncate">{badgeLabel}</span>
            </button>

            <Modal
                open={modalOpen}
                title={modalTitle}
                size="lg"
                dismissible={!locked}
                onClose={handleClose}
                footer={locked && phase !== 'complete' ? undefined : (
                    <>
                        {phase === 'complete' && (
                            <Button onClick={reloadNow}>Recharger maintenant</Button>
                        )}
                        {phase === 'error' && (
                            <>
                                <Button variant="ghost" onClick={handleClose}>Fermer</Button>
                                {canLaunch && (
                                    <Button disabled={starting} onClick={() => void handleConfirm()}>
                                        {starting ? 'En cours…' : 'Réessayer'}
                                    </Button>
                                )}
                            </>
                        )}
                        {phase === 'idle' && (
                            <>
                                <Button variant="ghost" onClick={handleClose}>Plus tard</Button>
                                <Button disabled={starting} onClick={() => void handleConfirm()}>
                                    {starting ? 'En cours…' : 'Mettre à jour maintenant'}
                                </Button>
                            </>
                        )}
                    </>
                )}
            >
                <p class="text-sm text-base-content/60">
                    {status.current_version}
                    {' '}
                    <span aria-hidden>→</span>
                    {' '}
                    {status.latest_version}
                </p>

                {phase === 'idle' && (
                    <div class="alert alert-warning text-sm" role="alert">
                        Les déploiements en cours échoueront. L’interface sera indisponible pendant le redémarrage.
                    </div>
                )}

                {locked && (
                    <div class="grid gap-4" role="status" aria-live="polite" aria-busy={phase !== 'complete'}>
                        <InstanceUpgradeStepper currentStep={uiStep} />
                        <ProgressBar
                            value={phase === 'complete' ? 100 : instanceUpgradeProgressPercent(status)}
                            tone={phase === 'complete' ? 'success' : 'warning'}
                            active={phase === 'progress' || phase === 'reviving'}
                            label={phase === 'complete' ? 'Terminé' : 'Installation'}
                        />
                        <div class={`flex items-center gap-3 rounded-xl border p-3 ${
                            phase === 'complete'
                                ? 'border-success/30 bg-success/10'
                                : 'border-base-300 bg-base-200/60'
                        }`}
                        >
                            {phase === 'complete' ? (
                                <CheckCircle2 class="size-4 sm:size-5 shrink-0 text-success" aria-hidden />
                            ) : (
                                <Loader2 class="size-4 sm:size-5 shrink-0 animate-spin text-warning" aria-hidden />
                            )}
                            <div class="min-w-0">
                                <p class="text-xs sm:text-sm font-medium">{message}</p>
                                <p class="font-mono text-xs text-base-content/55">
                                    Temps écoulé : {formatInstanceUpgradeElapsed(elapsedSeconds)}
                                </p>
                            </div>
                        </div>
                        {phase === 'complete' && (
                            <p class="text-center text-sm text-base-content/60">
                                Rechargement dans
                                {' '}
                                <span class="font-semibold text-warning">{successCountdown ?? 0}</span>
                                {' '}
                                seconde{(successCountdown ?? 0) > 1 ? 's' : ''}…
                            </p>
                        )}
                    </div>
                )}

                {phase === 'error' && (
                    <div class="flex items-start gap-2 sm:gap-3 rounded-xl border border-error/30 bg-error/10 p-3 text-error">
                        <AlertTriangle class="size-4 sm:size-5 shrink-0" aria-hidden />
                        <div class="grid gap-1 text-sm">
                            <p>{message ?? error ?? 'La mise à jour a échoué.'}</p>
                            <p class="text-base-content/60">
                                Consultez les logs sur le serveur dans le répertoire de l’instance (fichiers upgrade*).
                            </p>
                        </div>
                    </div>
                )}

                {(confirmError || (error && phase === 'idle')) && (
                    <p class="text-sm text-error">{confirmError ?? error}</p>
                )}
            </Modal>
        </>
    );
}
