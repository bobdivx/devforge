import { CheckCircle, ExternalLink, MessageSquareWarning, RefreshCw } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { AgentMission, FeatureDeliveryStatus } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';

type Props = {
    mission: AgentMission;
    onUpdated?: () => void;
};

export function FeatureDeliveryActions({ mission, onUpdated }: Props) {
    const [delivery, setDelivery] = useState<FeatureDeliveryStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [acting, setActing] = useState<'validate' | 'changes' | null>(null);
    const [feedback, setFeedback] = useState('');
    const [showFeedback, setShowFeedback] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await domainApi.missionDelivery(mission.uuid);
            setDelivery(response.data.feature_delivery);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible de charger le suivi feature.');
        } finally {
            setLoading(false);
        }
    };

    const validate = async () => {
        setActing('validate');
        setError(null);
        try {
            const response = await domainApi.validateMissionDelivery(mission.uuid, { merge_method: 'squash' });
            setDelivery(response.data.feature_delivery);
            onUpdated?.();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Merge impossible.');
        } finally {
            setActing(null);
        }
    };

    const requestChanges = async () => {
        const text = feedback.trim();
        if (!text) {
            setError('Décris les changements demandés.');
            return;
        }
        setActing('changes');
        setError(null);
        try {
            const response = await domainApi.requestMissionDeliveryChanges(mission.uuid, text);
            setDelivery(response.data.feature_delivery);
            setFeedback('');
            setShowFeedback(false);
            onUpdated?.();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Envoi du feedback impossible.');
        } finally {
            setActing(null);
        }
    };

    const meta = mission.metadata ?? {};
    const prUrl = delivery?.pull_request_url
        ?? (typeof meta.pull_request_url === 'string' ? meta.pull_request_url : null);
    const prNumber = delivery?.pull_request_number
        ?? (typeof meta.pull_request_number === 'number' ? meta.pull_request_number : null);
    const previewUrl = delivery?.preview?.fqdn ?? null;
    const canValidate = delivery?.can_validate
        ?? (prNumber !== null && prNumber > 0 && mission.status !== 'done');

    return (
        <div class="grid gap-2 rounded-md border border-primary/25 bg-primary/5 p-2">
            <div class="flex items-center justify-between gap-2">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-primary">Feature → preview</p>
                <button
                    type="button"
                    class="btn btn-ghost btn-xs h-6 min-h-6 gap-1 px-1.5"
                    disabled={loading}
                    onClick={() => void load()}
                >
                    <RefreshCw class={`size-3 ${loading ? 'animate-spin' : ''}`} aria-hidden />
                    Suivi
                </button>
            </div>

            {(prNumber || delivery) && (
                <div class="grid gap-1 text-[10px] text-base-content/70">
                    {prNumber ? (
                        <span>
                            PR #{prNumber}
                            {prUrl && (
                                <>
                                    {' · '}
                                    <a class="link link-primary" href={prUrl} rel="noreferrer" target="_blank">
                                        GitHub <ExternalLink class="inline size-2.5" aria-hidden />
                                    </a>
                                </>
                            )}
                        </span>
                    ) : (
                        <span>En attente de PR…</span>
                    )}
                    {previewUrl ? (
                        <a class="link link-primary truncate" href={previewUrl.startsWith('http') ? previewUrl : `https://${previewUrl}`} rel="noreferrer" target="_blank">
                            Preview {previewUrl}
                        </a>
                    ) : delivery && !delivery.preview_deployments_enabled ? (
                        <span>Previews désactivées — teste via la PR.</span>
                    ) : delivery ? (
                        <span>Preview pas encore prête.</span>
                    ) : null}
                    {delivery?.awaiting && (
                        <span class="opacity-70">Étape : {delivery.awaiting}</span>
                    )}
                </div>
            )}

            {error && <p class="text-[10px] text-error">{error}</p>}

            {showFeedback && (
                <div class="grid gap-1.5">
                    <textarea
                        class="textarea textarea-bordered textarea-xs min-h-16 w-full text-[11px]"
                        placeholder="Ce qui ne va pas / à corriger…"
                        value={feedback}
                        onInput={(event) => setFeedback((event.target as HTMLTextAreaElement).value)}
                    />
                    <div class="flex flex-wrap gap-1">
                        <button
                            type="button"
                            class="btn btn-warning btn-xs h-7 min-h-7"
                            disabled={acting !== null}
                            onClick={() => void requestChanges()}
                        >
                            {acting === 'changes' ? 'Envoi…' : 'Envoyer'}
                        </button>
                        <button
                            type="button"
                            class="btn btn-ghost btn-xs h-7 min-h-7"
                            disabled={acting !== null}
                            onClick={() => setShowFeedback(false)}
                        >
                            Annuler
                        </button>
                    </div>
                </div>
            )}

            {!showFeedback && canValidate && mission.status !== 'done' && (
                <div class="flex flex-wrap gap-1">
                    <button
                        type="button"
                        class="btn btn-primary btn-xs h-7 min-h-7 gap-1"
                        disabled={acting !== null}
                        onClick={() => void validate()}
                    >
                        <CheckCircle class="size-3.5" aria-hidden />
                        {acting === 'validate' ? 'Merge…' : 'Valider & merger'}
                    </button>
                    <button
                        type="button"
                        class="btn btn-ghost btn-xs h-7 min-h-7 gap-1"
                        disabled={acting !== null}
                        onClick={() => setShowFeedback(true)}
                    >
                        <MessageSquareWarning class="size-3.5" aria-hidden />
                        Changements
                    </button>
                </div>
            )}
        </div>
    );
}
