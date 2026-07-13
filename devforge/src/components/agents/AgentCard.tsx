import { Play, Settings2, Pause, RefreshCw } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Agent } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';
import { routeHref } from '../../lib/routes';
import { scheduleLabel } from '../../lib/agent-triggers';
import { AgentAvatar } from './AgentAvatar';
import { AgentErrorAlert } from './AgentErrorAlert';
import { AgentStatusBadge } from './AgentStatusBadge';

const typeLabels: Record<string, string> = {
    debug: 'Débogage',
    'tech-watch': 'Veille Tech',
    github: 'GitHub',
    devforge: 'DevForge',
    deployment: 'Déploiement',
    security: 'Sécurité',
};

function relativeTime(isoDate: string | null): string {
    if (!isoDate) {
        return 'Jamais';
    }
    const diff = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) {
        return "À l'instant";
    }
    if (minutes < 60) {
        return `Il y a ${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `Il y a ${hours} h`;
    }
    return `Il y a ${Math.floor(hours / 24)} j`;
}

type Props = {
    agent: Agent;
    onNavigate: (event: MouseEvent, path: string) => void;
    onRefresh: () => void;
};

export function AgentCard({ agent, onNavigate, onRefresh }: Props) {
    const [running, setRunning] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [runError, setRunError] = useState<string | null>(null);
    const pollIntervalRef = useRef<number | null>(null);
    const runStartedAtRef = useRef<string | null>(null);

    const stopPolling = () => {
        if (pollIntervalRef.current !== null) {
            window.clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
    };

    useEffect(() => {
        if (agent.status === 'running') {
            setRunning(true);
            return;
        }

        const latestRunAt = agent.latest_run?.created_at ?? null;
        const hasFreshRun = runStartedAtRef.current !== null
            && latestRunAt !== null
            && new Date(latestRunAt).getTime() >= new Date(runStartedAtRef.current).getTime();

        if (hasFreshRun || agent.status === 'error') {
            stopPolling();
            setRunning(false);
            runStartedAtRef.current = null;
        }
    }, [agent.status, agent.latest_run?.created_at]);

    useEffect(() => () => stopPolling(), []);

    const pollAfterRun = () => {
        stopPolling();
        let attempts = 0;

        pollIntervalRef.current = window.setInterval(() => {
            attempts += 1;
            onRefresh();

            if (attempts >= 90) {
                stopPolling();
                setRunning(false);
                runStartedAtRef.current = null;
            }
        }, 1500);
    };

    const handleRun = async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (running || agent.status === 'running') {
            return;
        }
        setRunning(true);
        setRunError(null);
        runStartedAtRef.current = new Date().toISOString();
        try {
            await domainApi.runAgent(agent.uuid);
            onRefresh();
            pollAfterRun();
        } catch (error) {
            setRunError(error instanceof ApiError ? error.message : "Impossible de lancer l'agent.");
            setRunning(false);
            runStartedAtRef.current = null;
        }
    };

    const handleToggleActive = async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setToggling(true);
        try {
            await domainApi.updateAgent(agent.uuid, {
                is_active: !agent.is_active,
                status: agent.is_active ? 'paused' : 'idle',
            });
            onRefresh();
        } catch {
            // ignore
        } finally {
            setToggling(false);
        }
    };

    const detailPath = `/agents/${agent.uuid}`;
    const isRunning = agent.status === 'running' || running;
    const displayStatus = isRunning ? 'running' : agent.status;

    return (
        <article
            class="card border border-base-300 bg-base-100 transition-shadow hover:shadow-md cursor-pointer"
            onClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest('button, a')) {
                    return;
                }
                onNavigate(e as unknown as MouseEvent, detailPath);
            }}
        >
            <div class="card-body gap-4 p-4">
                <div class="flex items-start gap-3">
                    <AgentAvatar type={agent.type} color={agent.avatar_color} name={agent.name} />
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <a
                                class="truncate text-sm font-semibold hover:underline"
                                href={routeHref(detailPath)}
                                onClick={(e) => onNavigate(e as unknown as MouseEvent, detailPath)}
                            >
                                {agent.name}
                            </a>
                            {agent.sub_agents_count > 0 && (
                                <span class="badge badge-xs border-base-300 bg-base-200 text-base-content/50">
                                    +{agent.sub_agents_count}
                                </span>
                            )}
                        </div>
                        <p class="text-[11px] text-base-content/50">
                            {typeLabels[agent.type] ?? agent.type}
                            {agent.provider && (
                                <span class="ml-1 before:me-1 before:content-['·']">{agent.provider.provider}/{agent.provider.model}</span>
                            )}
                        </p>
                    </div>
                    <AgentStatusBadge status={displayStatus} />
                </div>

                {agent.description && (
                    <p class="line-clamp-2 text-xs text-base-content/65">{agent.description}</p>
                )}

                <AgentErrorAlert agent={agent} compact onNavigate={onNavigate} />

                {runError && (
                    <p class="rounded-md border border-error/30 bg-error/10 px-2 py-1.5 text-[11px] text-error" role="alert">
                        {runError}
                    </p>
                )}

                <div class="flex items-center justify-between border-t border-base-300 pt-3">
                    <div class="text-[11px] text-base-content/50">
                        {scheduleLabel(agent)}
                        <span class="ms-2 before:me-1 before:content-['·']">
                            {relativeTime(agent.last_run_at)}
                        </span>
                    </div>
                    <div class="flex gap-1">
                        <button
                            class="btn btn-ghost btn-xs gap-1"
                            type="button"
                            title={agent.is_active ? "Suspendre l'agent" : "Activer l'agent"}
                            disabled={toggling}
                            onClick={handleToggleActive}
                        >
                            {toggling
                                ? <RefreshCw class="size-3 animate-spin" aria-hidden />
                                : <Pause class="size-3" aria-hidden />}
                        </button>
                        <button
                            class={`btn btn-xs gap-1 ${isRunning ? 'btn-disabled' : 'btn-primary'}`}
                            type="button"
                            title="Lancer maintenant"
                            disabled={isRunning || !agent.is_active || !agent.provider}
                            onClick={handleRun}
                        >
                            {isRunning
                                ? <span class="loading loading-spinner loading-xs" aria-label="En cours" />
                                : <Play class="size-3" aria-hidden />}
                            {!isRunning && 'Lancer'}
                        </button>
                        <a
                            class="btn btn-ghost btn-xs"
                            href={routeHref(detailPath)}
                            title="Configurer"
                            onClick={(e) => onNavigate(e as unknown as MouseEvent, detailPath)}
                        >
                            <Settings2 class="size-3" aria-hidden />
                        </a>
                    </div>
                </div>
            </div>
        </article>
    );
}
