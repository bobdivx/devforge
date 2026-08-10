import {
    Bot,
    Boxes,
    ChevronDown,
    ChevronRight,
    ExternalLink,
    FolderGit2,
    GitBranch,
    Globe2,
    Rocket,
    Search,
    Sparkles,
} from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import type { DeploymentTopology, TopologyNode, TopologyTone } from '../../lib/domain-api';
import {
    buildApplicationPipelines,
    filterPipelines,
    HEALTH_LABELS,
    STAGE_LABELS,
    type ApplicationPipeline,
    type PipelineStage,
    type PipelineStageKind,
} from '../../lib/deployment-topology-layout';
import { routeHref } from '../../lib/routes';
import { useNavigate } from '../../lib/use-navigate';

type OperationsExplorerProps = {
    topology: DeploymentTopology;
};

const TONE_DOT: Record<TopologyTone, string> = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    error: 'bg-error',
    info: 'bg-info',
    neutral: 'bg-base-content/30',
};

const TONE_RING: Record<TopologyTone, string> = {
    primary: 'border-primary/40 bg-primary/5',
    success: 'border-success/35 bg-success/5',
    warning: 'border-warning/40 bg-warning/5',
    error: 'border-error/35 bg-error/5',
    info: 'border-info/35 bg-info/5',
    neutral: 'border-base-300 bg-base-100',
};

const HEALTH_PILL: Record<ApplicationPipeline['health'], string> = {
    healthy: 'badge-success',
    deploying: 'badge-warning',
    failing: 'badge-error',
    unknown: 'badge-ghost',
};

function StageIcon({ kind }: { kind: PipelineStageKind }) {
    const className = 'size-4 shrink-0 opacity-75';
    switch (kind) {
        case 'source':
            return <GitBranch class={className} aria-hidden />;
        case 'application':
            return <Boxes class={className} aria-hidden />;
        case 'deployment':
            return <Rocket class={className} aria-hidden />;
        case 'production':
            return <Globe2 class={className} aria-hidden />;
    }
}

function openHref(
    href: string | null,
    external: boolean | undefined,
    onNavigate: (event: MouseEvent, path: string) => void,
    event: MouseEvent,
) {
    if (!href) {
        return;
    }
    if (external || href.startsWith('http://') || href.startsWith('https://')) {
        return;
    }
    event.preventDefault();
    onNavigate(event, href);
}

function StageCard({
    stage,
    active,
    onSelect,
}: {
    stage: PipelineStage;
    active: boolean;
    onSelect: () => void;
}) {
    const missing = !stage.node;
    return (
        <button
            type="button"
            onClick={onSelect}
            class={`min-w-0 flex-1 rounded-2xl border px-3 py-3 text-left transition ${
                active
                    ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary/30'
                    : missing
                        ? 'border-dashed border-base-300/80 bg-base-200/30 opacity-80'
                        : `${TONE_RING[stage.tone]} hover:border-primary/40`
            }`}
        >
            <div class="mb-2 flex items-center justify-between gap-2">
                <span class="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-base-content/45">
                    <StageIcon kind={stage.kind} />
                    {STAGE_LABELS[stage.kind]}
                </span>
                <span class={`size-2 rounded-full ${TONE_DOT[stage.tone]}`} aria-hidden />
            </div>
            <p class={`truncate text-sm font-semibold ${missing ? 'text-base-content/45' : ''}`}>{stage.label}</p>
            <p class="mt-0.5 truncate text-xs text-base-content/50">{stage.detail}</p>
            {stage.status && (
                <p class="mt-2 truncate text-[11px] text-base-content/45">{stage.status}</p>
            )}
        </button>
    );
}

function DetailPanel({
    stage,
    pipeline,
}: {
    stage: PipelineStage | null;
    pipeline: ApplicationPipeline;
}) {
    const onNavigate = useNavigate();

    if (!stage) {
        return (
            <div class="rounded-2xl border border-base-300/70 bg-base-100 p-4 text-xs leading-relaxed text-base-content/55">
                Cliquez une étape du parcours pour voir le détail, les liens et l’activité agents associée.
            </div>
        );
    }

    const meta = stage.node?.meta ?? {};
    const lines: Array<{ label: string; value: string }> = [];
    if (typeof meta.git_repository === 'string' && meta.git_repository) {
        lines.push({ label: 'Dépôt', value: meta.git_repository });
    }
    if (typeof meta.git_branch === 'string' && meta.git_branch) {
        lines.push({ label: 'Branche', value: meta.git_branch });
    }
    if (typeof meta.url === 'string' && meta.url) {
        lines.push({ label: 'URL', value: meta.url });
    }
    if (typeof meta.commit === 'string' && meta.commit) {
        lines.push({ label: 'Commit', value: meta.commit.slice(0, 12) });
    }
    if (typeof meta.readiness_status === 'string' && meta.readiness_status) {
        lines.push({ label: 'Readiness', value: meta.readiness_status });
    }
    if (typeof meta.project === 'string' && meta.project) {
        lines.push({ label: 'Projet', value: meta.project });
    }

    const relatedAgents = stage.kind === 'deployment' || stage.kind === 'application' || stage.kind === 'production'
        ? pipeline.agents
        : [];

    return (
        <div class="grid min-w-0 gap-3 rounded-2xl border border-base-300/70 bg-base-100 p-4 shadow-sm">
            <div class="min-w-0">
                <p class="text-[11px] font-semibold uppercase tracking-widest text-base-content/45">
                    {STAGE_LABELS[stage.kind]}
                </p>
                <h3 class="mt-1 break-words text-base font-semibold">{stage.label}</h3>
                <p class="break-words text-xs text-base-content/55">{stage.detail}</p>
            </div>

            {lines.length > 0 && (
                <dl class="grid min-w-0 gap-2">
                    {lines.map((line) => (
                        <div key={line.label} class="min-w-0">
                            <dt class="text-[10px] uppercase tracking-wide text-base-content/40">{line.label}</dt>
                            <dd class="break-all text-xs font-medium">{line.value}</dd>
                        </div>
                    ))}
                </dl>
            )}

            {relatedAgents.length > 0 && (
                <div class="grid gap-2">
                    <p class="text-[11px] font-semibold uppercase tracking-widest text-base-content/45">Agents</p>
                    {relatedAgents.map(({ agent, interventions }) => (
                        <div key={agent.id} class="rounded-xl border border-base-300/70 bg-base-200/40 p-3">
                            <div class="flex items-center gap-2">
                                <Bot class="size-3.5 opacity-70" aria-hidden />
                                <p class="text-xs font-semibold">{agent.label}</p>
                                <span class="badge badge-ghost badge-xs">{agent.status ?? agent.subtitle}</span>
                            </div>
                            {interventions.length > 0 ? (
                                <ul class="mt-2 grid gap-1.5">
                                    {interventions.map((intervention) => (
                                        <li key={intervention.id} class="flex items-start gap-2 text-xs text-base-content/65">
                                            <Sparkles class="mt-0.5 size-3 shrink-0 opacity-60" aria-hidden />
                                            <span>{intervention.label}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p class="mt-1 text-[11px] text-base-content/45">Aucune intervention récente.</p>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {stage.href && (
                <a
                    class="btn btn-primary btn-sm w-full rounded-full"
                    href={stage.external || stage.href.startsWith('http') ? stage.href : routeHref(stage.href)}
                    target={stage.external || stage.href.startsWith('http') ? '_blank' : undefined}
                    rel={stage.external || stage.href.startsWith('http') ? 'noreferrer' : undefined}
                    onClick={(event) => openHref(stage.href, stage.external, onNavigate, event)}
                >
                    {(stage.external || stage.href.startsWith('http')) ? (
                        <>
                            <ExternalLink class="size-3.5" aria-hidden />
                            Ouvrir
                        </>
                    ) : (
                        'Voir dans DevForge'
                    )}
                </a>
            )}
        </div>
    );
}

function PipelineRow({
    pipeline,
    expanded,
    onToggle,
    selectedStageKind,
    onSelectStage,
}: {
    pipeline: ApplicationPipeline;
    expanded: boolean;
    onToggle: () => void;
    selectedStageKind: PipelineStageKind | null;
    onSelectStage: (kind: PipelineStageKind) => void;
}) {
    const selectedStage = pipeline.stages.find((stage) => stage.kind === selectedStageKind) ?? null;
    const agentCount = pipeline.agents.reduce((sum, item) => sum + item.interventions.length, pipeline.agents.length);

    return (
        <article class={`min-w-0 overflow-hidden rounded-2xl border bg-base-100 shadow-sm transition ${expanded ? 'border-primary/35' : 'border-base-300/70'}`}>
            <button
                type="button"
                class="flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left hover:bg-base-200/40 sm:px-4"
                onClick={onToggle}
                aria-expanded={expanded}
            >
                {expanded ? <ChevronDown class="size-4 shrink-0 opacity-60" aria-hidden /> : <ChevronRight class="size-4 shrink-0 opacity-60" aria-hidden />}
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <h2 class="truncate text-sm font-semibold">{pipeline.application.label}</h2>
                        <span class={`badge badge-sm ${HEALTH_PILL[pipeline.health]}`}>
                            {HEALTH_LABELS[pipeline.health]}
                        </span>
                        {pipeline.agents.length > 0 && (
                            <span class="badge badge-ghost badge-sm gap-1">
                                <Bot class="size-3" aria-hidden />
                                {pipeline.agents.length}
                            </span>
                        )}
                    </div>
                    <p class="mt-0.5 truncate text-xs text-base-content/50">
                        {pipeline.stages[0]?.label ?? '—'}
                        {' → '}
                        {pipeline.stages[3]?.label ?? 'pas d’URL'}
                    </p>
                </div>
                <span class="hidden text-[11px] text-base-content/40 sm:inline">
                    {expanded ? 'Réduire' : 'Explorer'}
                </span>
            </button>

            {!expanded && (
                <div class="flex items-center gap-1 overflow-x-auto px-4 pb-3" aria-hidden>
                    {pipeline.stages.map((stage, index) => (
                        <div key={stage.kind} class="flex items-center gap-1">
                            <span class={`size-2.5 rounded-full ${TONE_DOT[stage.tone]}`} />
                            {index < pipeline.stages.length - 1 && (
                                <span class="h-px w-6 bg-base-300" />
                            )}
                        </div>
                    ))}
                    {agentCount > 0 && (
                        <span class="ml-2 inline-flex items-center gap-1 text-[10px] text-base-content/45">
                            <Sparkles class="size-3" aria-hidden />
                            activité
                        </span>
                    )}
                </div>
            )}

            {expanded && (
                <div class="grid min-w-0 gap-4 border-t border-base-300/70 p-3 sm:p-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                    <div class="grid min-w-0 gap-3">
                        <div class="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-stretch">
                            {pipeline.stages.map((stage, index) => (
                                <div key={stage.kind} class="flex min-w-0 flex-1 items-stretch gap-2">
                                    <StageCard
                                        stage={stage}
                                        active={selectedStageKind === stage.kind}
                                        onSelect={() => onSelectStage(stage.kind)}
                                    />
                                    {index < pipeline.stages.length - 1 && (
                                        <div class="hidden w-4 shrink-0 items-center justify-center text-base-content/25 lg:flex" aria-hidden>
                                            →
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {pipeline.agents.length > 0 && (
                            <div class="rounded-2xl border border-base-300/60 bg-base-200/30 p-3">
                                <p class="mb-2 text-[11px] font-semibold uppercase tracking-widest text-base-content/45">
                                    Interventions agents
                                </p>
                                <div class="flex flex-wrap gap-2">
                                    {pipeline.agents.flatMap(({ agent, interventions }) => {
                                        if (interventions.length === 0) {
                                            return [(
                                                <span key={agent.id} class="inline-flex items-center gap-1.5 rounded-full border border-base-300 bg-base-100 px-2.5 py-1 text-[11px]">
                                                    <Bot class="size-3 opacity-60" aria-hidden />
                                                    {agent.label}
                                                </span>
                                            )];
                                        }
                                        return interventions.map((intervention) => (
                                            <span key={intervention.id} class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px]">
                                                <Sparkles class="size-3 shrink-0 opacity-70" aria-hidden />
                                                <span class="truncate">{intervention.label}</span>
                                            </span>
                                        ));
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    <DetailPanel stage={selectedStage} pipeline={pipeline} />
                </div>
            )}
        </article>
    );
}

export function TopologySummaryChips({
    summary,
}: {
    summary: DeploymentTopology['summary'];
}) {
    const chips = [
        { label: 'Apps', value: summary.applications, icon: <Boxes class="size-3.5" aria-hidden /> },
        { label: 'URLs live', value: summary.production_urls, icon: <Globe2 class="size-3.5" aria-hidden /> },
        { label: 'Joignables', value: summary.reachable_urls, icon: <Globe2 class="size-3.5 text-success" aria-hidden /> },
        { label: 'GitHub', value: summary.github_connections, icon: <FolderGit2 class="size-3.5" aria-hidden /> },
        { label: 'Agents', value: summary.agents, icon: <Bot class="size-3.5" aria-hidden /> },
        { label: 'Interventions', value: summary.interventions, icon: <Sparkles class="size-3.5" aria-hidden /> },
    ];

    return (
        <div class="flex flex-wrap gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:overflow-visible">
            {chips.map((chip) => (
                <div key={chip.label} class="inline-flex shrink-0 items-center gap-2 rounded-full border border-base-300/70 bg-base-100 px-3 py-1.5 text-xs shadow-sm">
                    {chip.icon}
                    <span class="text-base-content/55">{chip.label}</span>
                    <span class="font-semibold tabular-nums">{chip.value}</span>
                </div>
            ))}
        </div>
    );
}

export function OperationsExplorer({ topology }: OperationsExplorerProps) {
    const overview = useMemo(() => buildApplicationPipelines(topology), [topology]);
    const [query, setQuery] = useState('');
    const [health, setHealth] = useState<ApplicationPipeline['health'] | 'all'>('all');
    const [expandedId, setExpandedId] = useState<string | null>(overview.pipelines[0]?.id ?? null);
    const [selectedStages, setSelectedStages] = useState<Record<string, PipelineStageKind>>({});

    const filtered = useMemo(
        () => filterPipelines(overview.pipelines, query, health),
        [overview.pipelines, query, health],
    );

    return (
        <div class="grid min-w-0 gap-4">
            <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label class="input input-sm flex w-full min-w-0 max-w-md flex-1 items-center gap-2 rounded-full border-base-300 bg-base-100">
                    <Search class="size-3.5 shrink-0 opacity-50" aria-hidden />
                    <input
                        type="search"
                        class="min-w-0 grow"
                        placeholder="Rechercher une app, un dépôt, une URL…"
                        value={query}
                        onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
                    />
                </label>
                <div class="flex max-w-full flex-wrap gap-1.5">
                    {(['all', 'healthy', 'deploying', 'failing', 'unknown'] as const).map((value) => (
                        <button
                            key={value}
                            type="button"
                            class={`btn btn-xs h-8 min-h-8 rounded-full px-2.5 ${health === value ? 'btn-primary' : 'btn-ghost border border-base-300/80'}`}
                            onClick={() => setHealth(value)}
                        >
                            {HEALTH_LABELS[value]}
                        </button>
                    ))}
                </div>
            </div>

            {overview.githubConnections.length > 0 && (
                <div class="flex flex-wrap items-center gap-2 text-xs text-base-content/55">
                    <FolderGit2 class="size-3.5" aria-hidden />
                    <span>Connexions GitHub :</span>
                    {overview.githubConnections.map((connection) => (
                        <span key={connection.id} class="rounded-full border border-base-300 bg-base-100 px-2.5 py-1 font-medium text-base-content/80">
                            {connection.label}
                        </span>
                    ))}
                </div>
            )}

            {filtered.length === 0 ? (
                <p class="rounded-2xl border border-dashed border-base-300 py-10 text-center text-sm text-base-content/50">
                    Aucune application ne correspond à ce filtre.
                </p>
            ) : (
                <div class="grid gap-3">
                    {filtered.map((pipeline) => (
                        <PipelineRow
                            key={pipeline.id}
                            pipeline={pipeline}
                            expanded={expandedId === pipeline.id}
                            onToggle={() => {
                                setExpandedId((current) => (current === pipeline.id ? null : pipeline.id));
                                setSelectedStages((current) => (
                                    current[pipeline.id]
                                        ? current
                                        : { ...current, [pipeline.id]: 'application' }
                                ));
                            }}
                            selectedStageKind={expandedId === pipeline.id ? (selectedStages[pipeline.id] ?? 'application') : null}
                            onSelectStage={(kind) => {
                                setExpandedId(pipeline.id);
                                setSelectedStages((current) => ({ ...current, [pipeline.id]: kind }));
                            }}
                        />
                    ))}
                </div>
            )}

            {overview.orphanAgents.length > 0 && (
                <OrphanAgents agents={overview.orphanAgents} />
            )}
        </div>
    );
}

function OrphanAgents({ agents }: { agents: TopologyNode[] }) {
    const onNavigate = useNavigate();

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 p-4">
            <p class="text-[11px] font-semibold uppercase tracking-widest text-base-content/45">Agents non assignés</p>
            <div class="mt-3 flex flex-wrap gap-2">
                {agents.map((agent) => (
                    <a
                        key={agent.id}
                        class="inline-flex items-center gap-2 rounded-full border border-base-300 px-3 py-1.5 text-xs hover:border-primary/40"
                        href={agent.href ? routeHref(agent.href) : routeHref('/agents')}
                        onClick={(event) => {
                            if (agent.href) {
                                onNavigate(event, agent.href);
                            }
                        }}
                    >
                        <Bot class="size-3.5 opacity-70" aria-hidden />
                        {agent.label}
                    </a>
                ))}
            </div>
        </section>
    );
}
