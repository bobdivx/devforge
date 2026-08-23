import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Shield } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import {
    domainApi,
    type ApplicationReadiness,
    type ApplicationReadinessStatus,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { DataState } from '../ui/DataState';

type Props = {
    applicationUuid: string;
    canAct: boolean;
};

const statusLabels: Record<ApplicationReadinessStatus, string> = {
    idle: 'En attente',
    probing: 'Vérification…',
    healthy: 'Sain',
    recovering: 'Récupération…',
    awaiting_user: 'Action requise',
    failed: 'Échec',
};

const GENERIC_INTERVENTION_TITLES = new Set([
    'intervention requise',
    'intervention utilisateur requise',
    'action requise',
    'action humaine requise',
]);

function statusTone(status: ApplicationReadinessStatus): string {
    switch (status) {
        case 'healthy':
            return 'text-success';
        case 'awaiting_user':
        case 'failed':
            return 'text-warning';
        case 'probing':
        case 'recovering':
            return 'text-info';
        default:
            return 'text-base-content/55';
    }
}

function shouldPoll(status: ApplicationReadinessStatus): boolean {
    return status === 'probing' || status === 'recovering' || status === 'awaiting_user';
}

function needsAttention(status: ApplicationReadinessStatus): boolean {
    return status === 'awaiting_user' || status === 'failed' || status === 'recovering' || status === 'probing';
}

function isGenericInterventionTitle(title: string): boolean {
    return GENERIC_INTERVENTION_TITLES.has(title.trim().toLowerCase());
}

function formatProbeError(readiness: ApplicationReadiness): string | null {
    const error = readiness.last_probe_error?.trim() ?? '';
    if (error !== '') {
        if (
            readiness.last_http_status
            && !error.toLowerCase().includes(`http ${readiness.last_http_status}`)
        ) {
            return `HTTP ${readiness.last_http_status} — ${error}`;
        }

        return error;
    }

    if (readiness.last_http_status) {
        return `HTTP ${readiness.last_http_status}`;
    }

    return null;
}

/** Keep only the diagnostic part of the summary when the probe error is already shown above. */
function actionExplanation(summary: string | null, probeError: string | null): string | null {
    if (!summary) {
        return null;
    }

    let text = summary.trim().replace(/^Erreur détectée\s*:\s*.+(?:\n\n|$)/iu, '').trim();
    if (text === '') {
        return null;
    }

    if (probeError) {
        const normalized = text.toLowerCase();
        const error = probeError.toLowerCase();
        if (
            normalized === error
            || normalized === `http ${error}`
            || (normalized.includes(error) && text.length <= probeError.length + 24)
        ) {
            return null;
        }
    }

    return text;
}

export function ApplicationReadinessCard({ applicationUuid, canAct }: Props) {
    const readinessQuery = useApiQuery(
        `readiness:${applicationUuid}`,
        () => domainApi.applicationReadiness(applicationUuid),
    );
    const [busy, setBusy] = useState<'toggle' | 'probe' | 'done' | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    const readiness = readinessQuery.data?.data ?? null;

    useEffect(() => {
        if (!readiness || !shouldPoll(readiness.status)) {
            return;
        }

        const interval = window.setInterval(() => {
            void readinessQuery.reload({ silent: true });
        }, 4000);

        return () => window.clearInterval(interval);
    }, [readiness?.status, applicationUuid, readinessQuery.reload]);

    const runToggle = async (enabled: boolean) => {
        setBusy('toggle');
        setActionError(null);
        try {
            await domainApi.updateApplicationReadiness(applicationUuid, {
                autonomous_enabled: enabled,
            });
            await readinessQuery.reload();
        } catch {
            setActionError('Impossible de mettre à jour la surveillance.');
        } finally {
            setBusy(null);
        }
    };

    const runProbe = async () => {
        setBusy('probe');
        setActionError(null);
        try {
            await domainApi.probeApplicationReadiness(applicationUuid);
            await readinessQuery.reload();
        } catch {
            setActionError('La vérification manuelle a échoué.');
        } finally {
            setBusy(null);
        }
    };

    const runDone = async (interventionUuid: string) => {
        setBusy('done');
        setActionError(null);
        try {
            await domainApi.acknowledgeApplicationReadinessIntervention(
                applicationUuid,
                interventionUuid,
            );
            await readinessQuery.reload();
        } catch {
            setActionError('Impossible de confirmer l’intervention.');
        } finally {
            setBusy(null);
        }
    };

    const showIntervention = readiness?.intervention && readiness.status === 'awaiting_user';
    const probeError = readiness ? formatProbeError(readiness) : null;
    const actionTitle = readiness?.intervention && !isGenericInterventionTitle(readiness.intervention.title)
        ? readiness.intervention.title
        : null;
    const explanation = readiness?.intervention
        ? actionExplanation(readiness.intervention.summary, probeError)
        : null;

    return (
        <DataState
            loading={readinessQuery.loading && !readiness}
            error={readinessQuery.error}
            onRetry={() => void readinessQuery.reload()}
        >
            {readiness && (
                <section class="min-w-0 overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
                    <div class="toolbar-row border-b border-base-300/70 px-2.5 sm:px-3 md:px-4 py-2.5 sm:py-3 sm:px-5">
                        <div class="min-w-0">
                            <p class="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold">
                                <Shield class="size-3.5 sm:size-4 text-base-content/45" aria-hidden />
                                Surveillance
                            </p>
                            {!needsAttention(readiness.status) && (
                                <p class="text-xs text-base-content/50">
                                    Healthcheck + probe HTTP après déploiement
                                </p>
                            )}
                        </div>
                        <span class={`shrink-0 text-xs font-medium ${statusTone(readiness.status)}`}>
                            {statusLabels[readiness.status]}
                        </span>
                    </div>

                    <div class="grid gap-2 sm:gap-3 p-4 sm:p-5">
                        <div class="flex flex-wrap items-center justify-between gap-3">
                            <label class="inline-flex cursor-pointer items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    class="toggle toggle-sm toggle-primary"
                                    checked={readiness.autonomous_enabled}
                                    disabled={!canAct || busy !== null}
                                    onChange={(event) => {
                                        void runToggle((event.target as HTMLInputElement).checked);
                                    }}
                                />
                                Autonome
                            </label>
                            {canAct && (
                                <button
                                    class="btn btn-ghost btn-xs rounded-full border border-base-300/80"
                                    type="button"
                                    disabled={busy !== null}
                                    onClick={() => void runProbe()}
                                >
                                    {busy === 'probe' ? (
                                        <Loader2 class="size-3.5 animate-spin" aria-hidden />
                                    ) : (
                                        <RefreshCw class="size-3.5" aria-hidden />
                                    )}
                                    Vérifier
                                </button>
                            )}
                        </div>

                        {needsAttention(readiness.status) && !showIntervention && (
                            <dl class="grid gap-2 text-sm">
                                {readiness.probe_url && (
                                    <div class="flex flex-wrap gap-x-2 gap-y-1">
                                        <dt class="text-base-content/45">URL</dt>
                                        <dd class="break-all font-mono text-xs">{readiness.probe_url}</dd>
                                    </div>
                                )}
                                {(readiness.round > 0 || readiness.status === 'recovering') && (
                                    <div class="flex flex-wrap gap-x-2 gap-y-1">
                                        <dt class="text-base-content/45">Tour</dt>
                                        <dd>
                                            {readiness.round} / {readiness.max_rounds}
                                        </dd>
                                    </div>
                                )}
                                {probeError && readiness.status !== 'healthy' && (
                                    <p class="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                                        {probeError}
                                    </p>
                                )}
                            </dl>
                        )}

                        {showIntervention && readiness.intervention && (
                            <div class="rounded-xl border border-warning/40 bg-warning/5 p-4">
                                <div class="mb-3 inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-warning">
                                    <AlertTriangle class="size-3.5 sm:size-4 shrink-0" aria-hidden />
                                    Intervention requise
                                </div>

                                <div class="mb-4 grid gap-3">
                                    <div class="rounded-lg border border-warning/25 bg-base-100/70 px-3 py-2.5">
                                        <p class="text-[11px] font-semibold uppercase tracking-wide text-warning/80">
                                            Erreur détectée
                                        </p>
                                        <p class="mt-1 text-xs sm:text-sm font-medium text-base-content">
                                            {probeError
                                                ?? readiness.intervention.summary
                                                ?? 'Le domaine public ne répond pas correctement.'}
                                        </p>
                                        {readiness.probe_url && (
                                            <p class="mt-1 break-all font-mono text-[11px] text-base-content/50">
                                                {readiness.probe_url}
                                            </p>
                                        )}
                                    </div>

                                    <div class="rounded-lg border border-base-300/60 bg-base-100/70 px-3 py-2.5">
                                        <p class="text-[11px] font-semibold uppercase tracking-wide text-base-content/45">
                                            Ce que vous devez faire
                                        </p>
                                        {actionTitle && (
                                            <p class="mt-1 text-xs sm:text-sm font-semibold text-base-content">
                                                {actionTitle}
                                            </p>
                                        )}
                                        {explanation && (
                                            <p class="mt-1 text-sm text-base-content/70">
                                                {explanation}
                                            </p>
                                        )}
                                        {readiness.intervention.steps.length > 0 ? (
                                            <ol class="mt-3 grid list-decimal gap-2 ps-5 text-sm">
                                                {readiness.intervention.steps.map((step) => (
                                                    <li
                                                        key={`${step.rank}-${step.text}`}
                                                        class="marker:text-base-content/40"
                                                    >
                                                        <span class={step.done ? 'line-through opacity-60' : ''}>
                                                            {step.text}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ol>
                                        ) : (
                                            <p class="mt-2 text-sm text-base-content/65">
                                                Corrigez le problème ci-dessus, puis confirmez pour relancer la vérification.
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {canAct && (
                                    <div class="grid gap-2">
                                        <button
                                            class="btn btn-primary btn-sm rounded-full"
                                            type="button"
                                            disabled={busy !== null}
                                            onClick={() => void runDone(readiness.intervention!.uuid)}
                                        >
                                            {busy === 'done' ? (
                                                <>
                                                    <Loader2 class="size-3.5 animate-spin" aria-hidden />
                                                    Re-vérification…
                                                </>
                                            ) : (
                                                <>
                                                    <CheckCircle2 class="size-3.5" aria-hidden />
                                                    C’est fait
                                                </>
                                            )}
                                        </button>
                                        <p class="text-[11px] text-base-content/50">
                                            Après avoir corrigé l’erreur, confirmez pour relancer la vérification du domaine.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {actionError && (
                            <p class="text-sm text-error">{actionError}</p>
                        )}
                    </div>
                </section>
            )}
        </DataState>
    );
}
