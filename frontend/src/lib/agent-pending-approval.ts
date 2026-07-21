export type SourceWriteDiffPreview = {
    path: string;
    is_new_file: boolean;
    lines_added: number;
    lines_removed: number;
    diff: string;
    read_error?: string;
};

export type PendingToolApproval = {
    status: 'ask';
    tool: string;
    reason: string;
    rule_id?: string;
    approval_key?: string;
    diff_preview?: SourceWriteDiffPreview;
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
        diff_preview: parseDiffPreview(pending.diff_preview),
        resolved: typeof pending.resolved === 'string' ? pending.resolved : undefined,
    };
}

function parseDiffPreview(raw: unknown): SourceWriteDiffPreview | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }

    const preview = raw as Record<string, unknown>;
    const path = typeof preview.path === 'string' ? preview.path : '';
    const diff = typeof preview.diff === 'string' ? preview.diff : '';

    if (path === '' || diff === '') {
        return undefined;
    }

    return {
        path,
        is_new_file: preview.is_new_file === true,
        lines_added: typeof preview.lines_added === 'number' ? preview.lines_added : 0,
        lines_removed: typeof preview.lines_removed === 'number' ? preview.lines_removed : 0,
        diff,
        read_error: typeof preview.read_error === 'string' ? preview.read_error : undefined,
    };
}

export function isPendingToolApproval(metadata: Record<string, unknown> | null | undefined): boolean {
    const pending = parsePendingToolApproval(metadata);

    return pending !== null && !pending.resolved;
}
