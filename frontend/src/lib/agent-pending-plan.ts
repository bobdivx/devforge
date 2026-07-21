export type PendingPlanStep = {
    id?: string;
    action: string;
    tool?: string | null;
    risk?: 'low' | 'medium' | 'high' | string;
};

export type PendingPlan = {
    status: 'ask';
    title: string;
    summary: string;
    steps: PendingPlanStep[];
    resolved?: 'approved' | 'denied' | string;
};

export function parsePendingPlan(metadata: Record<string, unknown> | null | undefined): PendingPlan | null {
    if (!metadata || typeof metadata !== 'object') {
        return null;
    }

    const raw = metadata.pending_plan;
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const pending = raw as Record<string, unknown>;
    const status = typeof pending.status === 'string' ? pending.status : '';
    const title = typeof pending.title === 'string' ? pending.title.trim() : '';
    const summary = typeof pending.summary === 'string' ? pending.summary.trim() : '';

    if (status !== 'ask' || title === '') {
        return null;
    }

    const stepsRaw = Array.isArray(pending.steps) ? pending.steps : [];
    const steps: PendingPlanStep[] = stepsRaw
        .filter((step): step is Record<string, unknown> => !!step && typeof step === 'object')
        .map((step) => ({
            id: typeof step.id === 'string' ? step.id : undefined,
            action: typeof step.action === 'string' ? step.action : '',
            tool: typeof step.tool === 'string' ? step.tool : null,
            risk: typeof step.risk === 'string' ? step.risk : undefined,
        }))
        .filter((step) => step.action !== '');

    return {
        status: 'ask',
        title,
        summary,
        steps,
        resolved: typeof pending.resolved === 'string' ? pending.resolved : undefined,
    };
}

export function isPendingPlan(metadata: Record<string, unknown> | null | undefined): boolean {
    const pending = parsePendingPlan(metadata);

    return pending !== null && !pending.resolved;
}
