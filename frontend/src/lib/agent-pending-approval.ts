export type PendingToolApproval = {
    status: 'ask';
    tool: string;
    reason: string;
    rule_id?: string;
    approval_key?: string;
    resolved?: 'approved' | 'denied' | string;
};

export function parsePendingToolApproval(metadata: Record<string, unknown> | null | undefined): PendingToolApproval | null {
    if (!metadata || typeof metadata !== 'object') {
        return null;
    }

    const raw = metadata.pending_approval;
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const pending = raw as Record<string, unknown>;
    const status = typeof pending.status === 'string' ? pending.status : '';
    const tool = typeof pending.tool === 'string' ? pending.tool.trim() : '';
    const reason = typeof pending.reason === 'string' ? pending.reason.trim() : '';

    if (status !== 'ask' || tool === '') {
        return null;
    }

    return {
        status: 'ask',
        tool,
        reason: reason || 'Approbation requise.',
        rule_id: typeof pending.rule_id === 'string' ? pending.rule_id : undefined,
        approval_key: typeof pending.approval_key === 'string' ? pending.approval_key : undefined,
        resolved: typeof pending.resolved === 'string' ? pending.resolved : undefined,
    };
}

export function isPendingToolApproval(metadata: Record<string, unknown> | null | undefined): boolean {
    const pending = parsePendingToolApproval(metadata);

    return pending !== null && !pending.resolved;
}
