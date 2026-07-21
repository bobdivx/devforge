export type CorrectionOutcome =
    | 'fixed'
    | 'partial'
    | 'failed'
    | 'no_action'
    | 'redeploy_only'
    | 'running';

export type CorrectionSourceScope =
    | 'coolify_only'
    | 'git_committed'
    | 'pull_request'
    | 'redeploy_only'
    | 'server_side'
    | 'none';

export type CorrectionAction = {
    kind: string;
    label?: string;
    detail?: string | null;
    commit_sha?: string | null;
    commit_url?: string | null;
    pr_url?: string | null;
    pr_number?: number | null;
    deployment_uuid?: string | null;
    ok?: boolean;
};

export type CorrectionPill = {
    id: string;
    label: string;
    active: boolean;
    href?: string | null;
    detail?: string | null;
};

export type AgentCorrectionSummary = {
    outcome: CorrectionOutcome | string;
    diagnosis?: string | null;
    headline: string;
    source_scope: CorrectionSourceScope | string;
    actions: CorrectionAction[];
    steps?: string[];
    pills: CorrectionPill[];
    belongs_to_deployment_uuid?: string | null;
};

export function outcomeLabel(outcome: string): string {
    switch (outcome) {
        case 'fixed':
            return 'Corrigé';
        case 'partial':
            return 'Partiel';
        case 'failed':
            return 'Échec';
        case 'no_action':
            return 'Aucune action';
        case 'redeploy_only':
            return 'Redeploy seul';
        case 'running':
            return 'En cours';
        case 'needs_user':
            return 'Action requise';
        default:
            return outcome;
    }
}

export function outcomeToneClass(outcome: string): string {
    switch (outcome) {
        case 'fixed':
            return 'border-success/30 bg-success/10 text-success';
        case 'partial':
        case 'redeploy_only':
        case 'needs_user':
            return 'border-warning/30 bg-warning/10 text-warning';
        case 'failed':
            return 'border-error/30 bg-error/10 text-error';
        case 'running':
            return 'border-info/30 bg-info/10 text-info';
        default:
            return 'border-base-300 bg-base-200/70 text-base-content/70';
    }
}

/** Whether the previous-failures group should start collapsed. */
export function shouldCollapsePreviousFailures(count: number, collapseAlways = true): boolean {
    if (collapseAlways) {
        return count > 0;
    }

    return count >= 3;
}

export function shortSha(sha: string | null | undefined): string | null {
    if (!sha) {
        return null;
    }

    return sha.length > 8 ? sha.slice(0, 7) : sha;
}
