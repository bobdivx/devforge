import { AlertCircle, X } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { Agent } from '../../lib/domain-api';
import { getAgentErrorMessage } from '../../lib/agent-errors';
import { agentDetailPath } from '../../lib/agent-routes';
import { routeHref } from '../../lib/routes';

type Props = {
    agent: Agent;
    compact?: boolean;
    onNavigate?: (event: MouseEvent, path: string) => void;
    /** Provider actuellement actif (si différent du default agent) */
    activeProvider?: string | null;
};

/**
 * Détermine si l'erreur est pertinente pour le contexte actuel.
 * Une erreur Ollama n'est pas pertinente si l'agent tourne actuellement sur Gemini.
 * Les erreurs 502 chroniques sont atténuées.
 */
function isErrorRelevant(
    agent: Agent,
    activeProvider: string | null | undefined,
): boolean {
    const errorMessage = getAgentErrorMessage(agent);
    if (!errorMessage) {
        return false;
    }

    // Si pas de provider actif spécifié, on montre l'erreur
    if (!activeProvider) {
        return true;
    }

    const lower = errorMessage.toLowerCase();
    const isOllamaError = lower.includes('ollama');
    const is502Error = lower.includes('502') || lower.includes('error code: 502');
    const isGeminiActive = activeProvider === 'gemini' || agent.provider?.provider === 'gemini';

    // Si l'erreur est Ollama 502 mais que l'agent tourne sur Gemini, on cache l'erreur
    if (isOllamaError && is502Error && isGeminiActive) {
        return false;
    }

    // Si l'erreur est Ollama mais que l'agent tourne sur Gemini, on cache l'erreur
    if (isOllamaError && isGeminiActive) {
        return false;
    }

    return true;
}

export function AgentErrorAlert({ agent, compact = false, onNavigate, activeProvider }: Props) {
    const [dismissed, setDismissed] = useState(false);

    const message = getAgentErrorMessage(agent);

    if (!message || dismissed || !isErrorRelevant(agent, activeProvider)) {
        return null;
    }

    const runUuid = agent.latest_run?.uuid;

    const detailPath = agentDetailPath(agent.uuid, {
        view: 'runs',
        run: runUuid,
    });

    return (
        <div
            class={`shrink-0 rounded-lg border border-error/30 bg-error/10 text-error ${compact ? 'px-3 py-2' : 'p-3'}`}
            role="alert"
        >
            <div class="flex items-start gap-2">
                <AlertCircle class={`mt-0.5 shrink-0 ${compact ? 'size-3.5' : 'size-4'}`} aria-hidden />
                <div class="min-w-0 flex-1">
                    <p class={`font-medium ${compact ? 'text-[11px]' : 'text-xs'}`}>Erreur récente</p>
                    <p class={`mt-0.5 break-words text-error/90 ${compact ? 'line-clamp-3 text-[11px]' : 'text-xs'}`}>
                        {message}
                    </p>
                    {onNavigate && runUuid && (
                        <a
                            class={`mt-1.5 inline-block font-medium underline underline-offset-2 hover:text-error ${compact ? 'text-[11px]' : 'text-xs'}`}
                            href={routeHref(detailPath)}
                            onClick={(e) => onNavigate(e as unknown as MouseEvent, detailPath)}
                        >
                            Voir les logs
                        </a>
                    )}
                </div>
                <button
                    type="button"
                    class="btn btn-ghost btn-xs size-5 sm:size-6 min-h-6 shrink-0 rounded-md p-0 text-error/70 hover:bg-error/20 hover:text-error"
                    aria-label="Masquer l'erreur"
                    onClick={() => setDismissed(true)}
                >
                    <X class="size-3.5" aria-hidden />
                </button>
            </div>
        </div>
    );
}
