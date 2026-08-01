import type { DeploymentTopology, TopologyNode, TopologyTone } from './domain-api';

export type PipelineStageKind = 'source' | 'application' | 'deployment' | 'production';

export type PipelineStage = {
    kind: PipelineStageKind;
    label: string;
    detail: string;
    tone: TopologyTone;
    status: string | null;
    href: string | null;
    external?: boolean;
    node: TopologyNode | null;
};

export type PipelineAgentActivity = {
    agent: TopologyNode;
    interventions: TopologyNode[];
};

export type ApplicationPipeline = {
    id: string;
    application: TopologyNode;
    stages: PipelineStage[];
    agents: PipelineAgentActivity[];
    health: 'healthy' | 'deploying' | 'failing' | 'unknown';
    searchable: string;
};

export type TopologyOverview = {
    pipelines: ApplicationPipeline[];
    orphanAgents: TopologyNode[];
    githubConnections: TopologyNode[];
};

const STAGE_LABELS: Record<PipelineStageKind, string> = {
    source: 'Source',
    application: 'Application',
    deployment: 'Déploiement',
    production: 'Production',
};

export { STAGE_LABELS };

function nodeById(topology: DeploymentTopology): Map<string, TopologyNode> {
    return new Map(topology.nodes.map((node) => [node.id, node]));
}

function neighbors(nodeId: string, topology: DeploymentTopology): Set<string> {
    const ids = new Set<string>([nodeId]);
    topology.edges.forEach((edge) => {
        if (edge.from === nodeId || edge.to === nodeId) {
            ids.add(edge.from);
            ids.add(edge.to);
        }
    });
    return ids;
}

function expand(ids: Set<string>, topology: DeploymentTopology): Set<string> {
    const next = new Set(ids);
    topology.edges.forEach((edge) => {
        if (ids.has(edge.from) || ids.has(edge.to)) {
            next.add(edge.from);
            next.add(edge.to);
        }
    });
    return next;
}

function pickType(ids: Set<string>, byId: Map<string, TopologyNode>, type: TopologyNode['type']): TopologyNode[] {
    return [...ids]
        .map((id) => byId.get(id))
        .filter((node): node is TopologyNode => !!node && node.type === type);
}

function deploymentHealth(deployment: TopologyNode | null, production: TopologyNode | null): ApplicationPipeline['health'] {
    const deployStatus = (deployment?.status ?? '').toLowerCase();
    if (deployStatus.includes('progress') || deployStatus.includes('queued') || deployStatus.includes('building')) {
        return 'deploying';
    }
    if (deployStatus.includes('fail') || production?.status === 'unreachable') {
        return 'failing';
    }
    if (production?.status === 'reachable' || deployStatus === 'finished') {
        return 'healthy';
    }
    return 'unknown';
}

function stageFromNodes(
    kind: PipelineStageKind,
    primary: TopologyNode | null,
    fallbackLabel: string,
    fallbackDetail: string,
): PipelineStage {
    if (!primary) {
        return {
            kind,
            label: fallbackLabel,
            detail: fallbackDetail,
            tone: 'neutral',
            status: null,
            href: null,
            node: null,
        };
    }

    return {
        kind,
        label: primary.label,
        detail: primary.subtitle,
        tone: primary.tone,
        status: primary.status,
        href: primary.href,
        external: Boolean(primary.meta?.external),
        node: primary,
    };
}

/**
 * Transforme le graphe brut en pipelines lisibles : une ligne claire par application.
 */
export function buildApplicationPipelines(topology: DeploymentTopology): TopologyOverview {
    const byId = nodeById(topology);
    const apps = topology.nodes.filter((node) => node.type === 'application');
    const claimedAgentIds = new Set<string>();

    const pipelines = apps.map((application) => {
        let linked = neighbors(application.id, topology);
        linked = expand(linked, topology);

        const repositories = pickType(linked, byId, 'repository');
        const githubs = pickType(linked, byId, 'github');
        const deployments = pickType(linked, byId, 'deployment');
        const productions = pickType(linked, byId, 'production');
        const interventions = pickType(linked, byId, 'intervention');
        const agents = pickType(linked, byId, 'agent');

        const sourceNode = repositories[0] ?? githubs[0] ?? null;
        const deploymentNode = deployments[0] ?? null;
        const productionNode = productions[0] ?? null;

        const sourceDetail = sourceNode
            ? (typeof sourceNode.meta?.git_branch === 'string' && sourceNode.meta.git_branch
                ? `Branche ${sourceNode.meta.git_branch}`
                : sourceNode.subtitle)
            : 'Aucun dépôt lié';

        const stages: PipelineStage[] = [
            stageFromNodes('source', sourceNode, 'Source Git', 'Aucun dépôt lié'),
            {
                ...stageFromNodes('application', application, application.label, application.subtitle),
                detail: typeof application.meta?.environment === 'string' && application.meta.environment
                    ? String(application.meta.environment)
                    : application.subtitle,
            },
            stageFromNodes(
                'deployment',
                deploymentNode,
                'Pas encore déployé',
                'Aucun déploiement récent',
            ),
            stageFromNodes(
                'production',
                productionNode,
                'Pas d’URL live',
                'Domaine non configuré',
            ),
        ];

        if (sourceNode && stages[0]) {
            stages[0].detail = sourceDetail;
        }

        const agentActivities: PipelineAgentActivity[] = agents.map((agent) => {
            claimedAgentIds.add(agent.id);
            const agentInterventions = interventions.filter((intervention) => {
                return topology.edges.some(
                    (edge) =>
                        (edge.from === agent.id && edge.to === intervention.id)
                        || (edge.to === agent.id && edge.from === intervention.id),
                );
            });
            return { agent, interventions: agentInterventions };
        });

        const claimedInterventionIds = new Set(
            agentActivities.flatMap((activity) => activity.interventions.map((item) => item.id)),
        );
        const orphanInterventions = interventions.filter(
            (intervention) => !claimedInterventionIds.has(intervention.id),
        );
        if (orphanInterventions.length > 0) {
            if (agentActivities[0]) {
                agentActivities[0].interventions.push(...orphanInterventions);
            } else {
                agentActivities.push({
                    agent: {
                        id: `agent:local:${application.id}`,
                        type: 'agent',
                        label: 'Intervention',
                        subtitle: 'Sans agent assigné',
                        tone: 'warning',
                        status: null,
                        href: null,
                        meta: {},
                    },
                    interventions: orphanInterventions,
                });
            }
        }

        return {
            id: application.id,
            application,
            stages,
            agents: agentActivities,
            health: deploymentHealth(deploymentNode, productionNode),
            searchable: [
                application.label,
                sourceNode?.label,
                deploymentNode?.label,
                productionNode?.label,
                ...agents.map((agent) => agent.label),
            ].filter(Boolean).join(' ').toLowerCase(),
        } satisfies ApplicationPipeline;
    });

    const orphanAgents = topology.nodes.filter(
        (node) => node.type === 'agent' && !claimedAgentIds.has(node.id),
    );

    return {
        pipelines,
        orphanAgents,
        githubConnections: topology.nodes.filter((node) => node.type === 'github'),
    };
}

export function filterPipelines(
    pipelines: ApplicationPipeline[],
    query: string,
    health: ApplicationPipeline['health'] | 'all',
): ApplicationPipeline[] {
    const needle = query.trim().toLowerCase();
    return pipelines.filter((pipeline) => {
        if (health !== 'all' && pipeline.health !== health) {
            return false;
        }
        if (!needle) {
            return true;
        }
        return pipeline.searchable.includes(needle);
    });
}

export const HEALTH_LABELS: Record<ApplicationPipeline['health'] | 'all', string> = {
    all: 'Tous',
    healthy: 'OK',
    deploying: 'En cours',
    failing: 'En alerte',
    unknown: 'Inconnu',
};
