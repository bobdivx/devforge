import { ArrowLeft, PanelRightOpen, Settings2, Users } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { AgentAvatar } from './AgentAvatar';
import { AgentSettingsPanel } from './AgentSettingsPanel';
import { AgentStatusBadge } from './AgentStatusBadge';
import { AgentConversationView } from './AgentConversationView';
import { AgentRunsView } from './AgentRunsView';
import type { Agent, AgentModelRouting } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import {
    agentDetailPath,
    agentDetailRunUuid,
    agentDetailSessionUuid,
    agentDetailView,
    rememberLastAgentChatUuid,
    shouldOpenAgentSettings,
    syncAgentDetailQuery,
} from '../../lib/agent-routes';
import { formatAgentProviderDisplay } from '../../lib/llm-models';
import { AgentModelRoutingBadge } from './AgentModelRoutingBadge';
import { routeHref } from '../../lib/routes';

type Props = {
    agent: Agent;
    onBack: (event: MouseEvent) => void;
    onAgentUpdated: () => void;
    userName?: string;
};

export function AgentChatView({ agent, onBack, onAgentUpdated, userName }: Props) {
    const [settingsOpen, setSettingsOpen] = useState(() => shouldOpenAgentSettings(window.location.search));
    const [viewMode, setViewMode] = useState<'chat' | 'runs'>(() => agentDetailView(window.location.search));
    const [focusedRunUuid, setFocusedRunUuid] = useState<string | null>(() => agentDetailRunUuid(window.location.search));
    const [focusedSessionUuid, setFocusedSessionUuid] = useState<string | null>(() => agentDetailSessionUuid(window.location.search));
    const [runsCount, setRunsCount] = useState(0);
    const [sessionsCount, setSessionsCount] = useState(0);
    const [runsActive, setRunsActive] = useState(agent.status === 'running');
    const [activeRouting, setActiveRouting] = useState<AgentModelRouting | null>(
        agent.latest_run?.metadata?.model_routing ?? null,
    );

    const toggleSettings = (open: boolean) => {
        setSettingsOpen(open);
        syncAgentDetailQuery({
            settings: open,
            view: viewMode,
            run: focusedRunUuid,
            session: focusedSessionUuid,
        });
    };

    const switchView = (mode: 'chat' | 'runs', runUuid: string | null = focusedRunUuid) => {
        setViewMode(mode);
        setFocusedRunUuid(runUuid);
        syncAgentDetailQuery({
            settings: settingsOpen,
            view: mode,
            run: mode === 'runs' ? runUuid : null,
            session: focusedSessionUuid,
        });
    };

    useEffect(() => {
        rememberLastAgentChatUuid(agent.uuid);
    }, [agent.uuid]);

    useEffect(() => {
        setSettingsOpen(shouldOpenAgentSettings(window.location.search));
        setViewMode(agentDetailView(window.location.search));
        setFocusedRunUuid(agentDetailRunUuid(window.location.search));
        setFocusedSessionUuid(agentDetailSessionUuid(window.location.search));
    }, [agent.uuid]);

    useEffect(() => {
        domainApi.agentRuns(agent.uuid)
            .then((response) => {
                setRunsCount(response.data.length);
                setRunsActive(
                    agent.status === 'running'
                    || response.data.some((run) => (
                        run.status === 'running'
                        || run.status === 'pending'
                        || run.status === 'waiting_for_subagents'
                    )),
                );
            })
            .catch(() => {});
    }, [agent.uuid, agent.status, agent.last_run_at]);

    useEffect(() => {
        domainApi.agentSessions(agent.uuid)
            .then((response) => setSessionsCount(response.data.length))
            .catch(() => {});
    }, [agent.uuid, agent.last_run_at]);

    const latestRun = agent.latest_run;
    const waitingForTeam = latestRun?.status === 'waiting_for_subagents'
        || (latestRun?.status === 'running' && Array.isArray(latestRun.metadata?.ephemeral_tasks) && (latestRun.metadata?.ephemeral_tasks?.length ?? 0) > 0);
    const teamRoles = Array.isArray(latestRun?.metadata?.ephemeral_tasks)
        ? latestRun!.metadata!.ephemeral_tasks!
            .map((task) => (typeof task.role_slug === 'string' && task.role_slug !== ''
                ? task.role_slug
                : (typeof task.leaf_profile === 'string' ? task.leaf_profile : null)))
            .filter((role): role is string => Boolean(role))
        : [];
    const uniqueRoles = [...new Set(teamRoles)];
    const teamRunPath = latestRun?.uuid
        ? agentDetailPath(agent.uuid, { view: 'runs', run: latestRun.uuid })
        : agentDetailPath(agent.uuid, { view: 'runs' });

    return (
        <div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-base-300 bg-base-100 sm:rounded-xl sm:border">
            <header class="grid shrink-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] grid-rows-[auto_auto] gap-x-1.5 sm:gap-x-2 md:gap-x-3 gap-y-2 border-b border-base-300 px-2.5 sm:px-3 md:px-4 py-2.5 sm:py-3">
                <button
                    class="btn btn-ghost btn-sm btn-square col-start-1 row-start-1 size-8 sm:size-9 min-h-8 sm:min-h-9 shrink-0 p-0"
                    type="button"
                    title="Retour aux agents"
                    onClick={onBack}
                >
                    <ArrowLeft class="size-3.5 sm:size-4" aria-hidden />
                </button>
                <div class="col-start-2 row-start-1">
                    <AgentAvatar
                        type={agent.type}
                        color={agent.avatar_color}
                        shape={agent.avatar_shape}
                        name={agent.name}
                        status={agent.status}
                    />
                </div>
                <div class="col-start-3 row-start-1 min-w-0 self-center overflow-hidden">
                    <h1 class="truncate text-[11px] sm:text-xs md:text-sm font-semibold">{agent.name}</h1>
                    <p class="mt-0.5 truncate text-[9px] sm:text-[10px] md:text-[11px] text-base-content/50">
                        {agent.provider
                            ? formatAgentProviderDisplay(agent.provider.provider, activeRouting)
                            : 'Auto (provider par défaut)'}
                    </p>
                </div>
                <button
                    class={`btn btn-ghost btn-sm btn-square col-start-4 row-start-1 size-8 sm:size-9 min-h-8 sm:min-h-9 shrink-0 p-0 ${settingsOpen ? 'bg-base-300' : ''}`}
                    type="button"
                    title="Configuration"
                    onClick={() => toggleSettings(!settingsOpen)}
                >
                    <Settings2 class="size-3.5 sm:size-4" aria-hidden />
                </button>
                <div class="col-span-3 col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-1 sm:gap-1.5 overflow-hidden">
                    <AgentStatusBadge status={agent.status} />
                    <AgentModelRoutingBadge routing={activeRouting} compact />
                </div>
            </header>

            {waitingForTeam && (
                <div class="flex shrink-0 items-start gap-1.5 sm:gap-2 border-b border-info/20 bg-info/10 px-2.5 sm:px-3 md:px-4 py-2 text-[11px] sm:text-xs text-info">
                    <Users class="mt-0.5 size-3 sm:size-3.5 shrink-0" aria-hidden />
                    <div class="min-w-0 flex-1">
                        <p class="font-medium">Équipe en cours…</p>
                        <p class="text-info/80 text-[10px] sm:text-[11px]">
                            {uniqueRoles.length > 0
                                ? `Rôles : ${uniqueRoles.join(', ')}`
                                : 'Sous-agents au travail — le handoff arrivera dans le chat.'}
                        </p>
                    </div>
                    <a
                        class="btn btn-ghost btn-xs shrink-0 text-info text-[10px] sm:text-xs"
                        href={routeHref(teamRunPath)}
                        onClick={(event) => {
                            event.preventDefault();
                            switchView('runs', latestRun?.uuid ?? null);
                        }}
                    >
                        Voir
                    </a>
                </div>
            )}

            {/* AgentViewSwitcher removed on mobile - conversation is default view */}

            <div class="flex min-h-0 min-w-0 flex-1">
                {viewMode === 'runs' ? (
                    <AgentRunsView
                        agent={agent}
                        initialRunUuid={focusedRunUuid}
                        onAgentUpdated={onAgentUpdated}
                    />
                ) : (
                    <AgentConversationView
                        agent={agent}
                        initialSessionUuid={focusedSessionUuid}
                        userName={userName}
                        onOpenPlugins={() => toggleSettings(true)}
                        onAgentUpdated={() => {
                            onAgentUpdated();
                            domainApi.agentSessions(agent.uuid)
                                .then((response) => setSessionsCount(response.data.length))
                                .catch(() => {});
                        }}
                        onRoutingChange={setActiveRouting}
                    />
                )}

                {settingsOpen && (
                    <aside class="hidden w-80 shrink-0 overflow-y-auto border-s border-base-300 bg-base-200/30 lg:block">
                        <AgentSettingsPanel agent={agent} onUpdated={onAgentUpdated} onClose={() => toggleSettings(false)} />
                    </aside>
                )}
            </div>

            {settingsOpen && (
                <div class="fixed inset-0 z-50 lg:hidden">
                    <button class="absolute inset-0 bg-black/50" type="button" aria-label="Fermer" onClick={() => toggleSettings(false)} />
                    <aside class="absolute inset-y-0 end-0 w-full max-w-sm overflow-y-auto border-s border-base-300 bg-base-100 shadow-xl">
                        <div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
                            <span class="text-sm font-semibold">Configuration</span>
                            <button class="btn btn-ghost btn-sm btn-square" type="button" onClick={() => toggleSettings(false)}>
                                <PanelRightOpen class="size-4" aria-hidden />
                            </button>
                        </div>
                        <AgentSettingsPanel agent={agent} onUpdated={onAgentUpdated} onClose={() => toggleSettings(false)} />
                    </aside>
                </div>
            )}
        </div>
    );
}
