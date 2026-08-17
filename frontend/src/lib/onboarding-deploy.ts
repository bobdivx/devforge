import type { CoreResource, Deployment, GithubRepository } from './domain-api';

export type OnboardingDeployPhase =
    | 'waiting'
    | 'creating'
    | 'queued'
    | 'building'
    | 'healthy'
    | 'failed';

export type OnboardingDeployItem = {
    repositoryId: number;
    name: string;
    fullName: string;
    uuid: string | null;
    phase: OnboardingDeployPhase;
    message: string | null;
};

const PHASE_RANK: Record<OnboardingDeployPhase, number> = {
    waiting: 0,
    creating: 1,
    queued: 2,
    building: 3,
    healthy: 4,
    failed: 5,
};

const PIPELINE_STEPS = ['Création', 'Build', 'Mise en ligne', 'Prêt'] as const;

export function onboardingDeployPipelineSteps(): readonly string[] {
    return PIPELINE_STEPS;
}

export function createInitialDeployItems(repositories: GithubRepository[]): OnboardingDeployItem[] {
    return repositories.map((repository) => ({
        repositoryId: repository.id,
        name: repository.name,
        fullName: repository.full_name,
        uuid: null,
        phase: 'waiting',
        message: null,
    }));
}

export function markDeployItemCreating(items: OnboardingDeployItem[], repositoryId: number): OnboardingDeployItem[] {
    return items.map((item) => item.repositoryId === repositoryId
        ? { ...item, phase: 'creating', message: 'Création de l’application…' }
        : item);
}

export function markDeployItemCreated(
    items: OnboardingDeployItem[],
    repositoryId: number,
    uuid: string,
): OnboardingDeployItem[] {
    return items.map((item) => item.repositoryId === repositoryId
        ? { ...item, uuid, phase: 'queued', message: 'Déploiement en file…' }
        : item);
}

export function markDeployItemFailed(
    items: OnboardingDeployItem[],
    repositoryId: number,
    message: string,
): OnboardingDeployItem[] {
    return items.map((item) => item.repositoryId === repositoryId
        ? { ...item, phase: 'failed', message }
        : item);
}

export function phaseFromDeploymentStatus(status: string): OnboardingDeployPhase {
    const normalized = status.trim().toLowerCase();

    if (normalized === 'failed' || normalized === 'cancelled-by-user' || normalized.includes('fail')) {
        return 'failed';
    }

    if (normalized === 'finished') {
        return 'healthy';
    }

    if (normalized === 'in_progress') {
        return 'building';
    }

    return 'queued';
}

export function phaseFromApplicationStatus(status: CoreResource['status']): OnboardingDeployPhase | null {
    if (typeof status !== 'string') {
        return null;
    }

    const [primary, health] = status.trim().toLowerCase().split(':');

    if (primary === 'running') {
        return health === 'unhealthy' ? 'building' : 'healthy';
    }

    if (primary === 'starting' || primary === 'restarting' || primary === 'created') {
        return 'building';
    }

    if (primary === 'exited' || primary === 'stopped' || primary === 'dead' || primary.includes('fail')) {
        return 'failed';
    }

    return null;
}

export function mergeOnboardingDeployStatus(
    items: OnboardingDeployItem[],
    deployments: Deployment[],
    applications: CoreResource[],
): OnboardingDeployItem[] {
    return items.map((item) => {
        if (item.phase === 'waiting' || item.phase === 'creating' || item.uuid === null) {
            return item;
        }

        const application = applications.find((resource) => resource.uuid === item.uuid);
        const fromApp = application ? phaseFromApplicationStatus(application.status) : null;
        const latest = deployments.find((deployment) => deployment.application?.uuid === item.uuid);
        const fromDeploy = latest ? phaseFromDeploymentStatus(latest.status) : null;
        const next = pickRicherPhase(fromApp, fromDeploy) ?? item.phase;

        if (item.phase === 'failed' && next !== 'healthy') {
            return item;
        }

        if (PHASE_RANK[next] < PHASE_RANK[item.phase] && item.phase !== 'failed') {
            return item;
        }

        return {
            ...item,
            phase: next,
            message: messageForPhase(next, latest?.commit_message ?? null),
        };
    });
}

export function onboardingDeployProgress(items: OnboardingDeployItem[]): {
    completed: number;
    failed: number;
    total: number;
    percent: number;
    canContinue: boolean;
    active: boolean;
} {
    const total = items.length;
    const completed = items.filter((item) => item.phase === 'healthy').length;
    const failed = items.filter((item) => item.phase === 'failed').length;
    const creating = items.some((item) => item.phase === 'waiting' || item.phase === 'creating');

    return {
        completed,
        failed,
        total,
        percent: total === 0 ? 0 : Math.round(((completed + failed) / total) * 100),
        canContinue: total > 0 && !creating,
        active: items.some((item) => item.phase !== 'healthy' && item.phase !== 'failed'),
    };
}

export function pipelineIndexForPhase(phase: OnboardingDeployPhase): number {
    if (phase === 'healthy') {
        return 3;
    }

    if (phase === 'building') {
        return 2;
    }

    if (phase === 'queued' || phase === 'creating') {
        return 1;
    }

    if (phase === 'failed') {
        return 1;
    }

    return 0;
}

export function overallPipelineIndex(items: OnboardingDeployItem[]): number {
    const active = items.filter((item) => item.phase !== 'failed');
    if (active.length === 0) {
        return items.length === 0 ? 0 : 1;
    }

    return Math.min(...active.map((item) => pipelineIndexForPhase(item.phase)));
}

export function phaseLabel(phase: OnboardingDeployPhase): string {
    switch (phase) {
        case 'waiting':
            return 'En attente';
        case 'creating':
            return 'Création';
        case 'queued':
            return 'En file';
        case 'building':
            return 'Build';
        case 'healthy':
            return 'En ligne';
        case 'failed':
            return 'Échec';
    }
}

function pickRicherPhase(
    fromApp: OnboardingDeployPhase | null,
    fromDeploy: OnboardingDeployPhase | null,
): OnboardingDeployPhase | null {
    if (fromApp === 'healthy' || fromDeploy === 'healthy') {
        return 'healthy';
    }

    if (fromDeploy === 'failed' && fromApp !== 'building') {
        return 'failed';
    }

    if (fromApp === 'building' || fromDeploy === 'building') {
        return 'building';
    }

    return fromApp ?? fromDeploy;
}

function messageForPhase(phase: OnboardingDeployPhase, commitMessage: string | null): string {
    switch (phase) {
        case 'queued':
            return 'En file d’attente sur le serveur…';
        case 'building':
            return commitMessage && commitMessage.trim() !== ''
                ? `Build · ${commitMessage}`
                : 'Build et déploiement en cours…';
        case 'healthy':
            return 'Application joignable';
        case 'failed':
            return 'Le déploiement a échoué';
        default:
            return '';
    }
}
