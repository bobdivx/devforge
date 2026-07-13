import { AlertCircle } from 'lucide-preact';
import type { Agent } from '../../lib/domain-api';
import { getAgentErrorMessage } from '../../lib/agent-errors';
import { routeHref } from '../../lib/routes';

type Props = {
    agent: Agent;
    compact?: boolean;
    onNavigate?: (event: MouseEvent, path: string) => void;
};

export function AgentErrorAlert({ agent, compact = false, onNavigate }: Props) {
    const message = getAgentErrorMessage(agent);

    if (!message) {
        return null;
    }

    const detailPath = `/agents/${agent.uuid}`;
    const runUuid = agent.latest_run?.uuid;

    return (
        <div
            class={`rounded-lg border border-error/30 bg-error/10 text-error ${compact ? 'px-3 py-2' : 'p-3'}`}
            role="alert"
        >
            <div class="flex items-start gap-2">
                <AlertCircle class={`mt-0.5 shrink-0 ${compact ? 'size-3.5' : 'size-4'}`} aria-hidden />
                <div class="min-w-0 flex-1">
                    <p class={`font-medium ${compact ? 'text-[11px]' : 'text-xs'}`}>Dernière erreur</p>
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
            </div>
        </div>
    );
}
