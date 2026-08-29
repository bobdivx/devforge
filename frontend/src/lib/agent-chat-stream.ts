import { ApiError } from './api-client';
import type { AgentChatMessage, AgentChatStep, AgentModelRouting } from './domain-api';
import { domainApi } from './domain-api';
import { isTerminalAgentRunStatus } from './agent-run-tracker';
import { emitSpotlightFromSteps } from './application-spotlight';

const API_BASE = '/api/devforge/v1';

export type StreamStatusPayload = {
    status?: string;
    iterations?: number;
    tokens_used?: number;
    summary?: string | null;
    live_assistant_text?: string | null;
    active_subagent_count?: number;
    steps?: AgentChatStep[];
    model_routing?: AgentModelRouting | null;
};

function readCookie(name: string): string | undefined {
    if (typeof document === 'undefined') {
        return undefined;
    }
    const encodedName = `${encodeURIComponent(name)}=`;
    const cookie = document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(encodedName));

    return cookie ? decodeURIComponent(cookie.slice(encodedName.length)) : undefined;
}

function parseSseChunk(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
    const parts = buffer.split('\n\n');
    const rest = parts.pop() ?? '';
    const events: Array<{ event: string; data: string }> = [];

    for (const part of parts) {
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of part.split('\n')) {
            if (line.startsWith('event:')) {
                event = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim());
            }
        }
        if (dataLines.length > 0) {
            events.push({ event, data: dataLines.join('\n') });
        }
    }

    return { events, rest };
}

function notifySpotlight(payload: StreamStatusPayload): void {
    emitSpotlightFromSteps(payload.steps);
}

/**
 * Attend la fin d’un run via SSE (fallback polling si SSE indisponible).
 */
export async function waitForChatReply(
    agentUuid: string,
    runUuid: string,
    sessionUuid: string,
    onMessages: (messages: AgentChatMessage[]) => void,
    onRouting?: (routing: AgentModelRouting) => void,
    onProgress?: (payload: StreamStatusPayload) => void,
): Promise<void> {
    try {
        await waitViaSse(agentUuid, runUuid, sessionUuid, onMessages, onRouting, onProgress);
    } catch {
        await waitViaPolling(agentUuid, runUuid, sessionUuid, onMessages, onRouting, onProgress);
    }
}

async function waitViaSse(
    agentUuid: string,
    runUuid: string,
    sessionUuid: string,
    onMessages: (messages: AgentChatMessage[]) => void,
    onRouting?: (routing: AgentModelRouting) => void,
    onProgress?: (payload: StreamStatusPayload) => void,
): Promise<void> {
    const headers = new Headers({ Accept: 'text/event-stream' });
    const csrfToken = readCookie('XSRF-TOKEN');
    if (csrfToken) {
        headers.set('X-XSRF-TOKEN', csrfToken);
    }

    const response = await fetch(
        `${API_BASE}/agents/${encodeURIComponent(agentUuid)}/runs/${encodeURIComponent(runUuid)}/stream?timeout=300`,
        { credentials: 'include', headers },
    );

    if (!response.ok || !response.body) {
        throw new ApiError(response.status, { message: 'SSE indisponible' });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;

    while (!finished) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;

        for (const item of parsed.events) {
            if (item.event === 'ping') {
                continue;
            }

            let data: Record<string, unknown> = {};
            try {
                data = JSON.parse(item.data) as Record<string, unknown>;
            } catch {
                continue;
            }

            if (item.event === 'status') {
                const payload = data as StreamStatusPayload;
                if (payload.model_routing) {
                    onRouting?.(payload.model_routing);
                }
                notifySpotlight(payload);
                onProgress?.(payload);
                continue;
            }

            if (item.event === 'done') {
                if (data.status === 'failed') {
                    throw new ApiError(502, { message: String(data.summary ?? 'La réponse de l\'agent a échoué.') });
                }
                const messages = await domainApi.agentSessionMessages(agentUuid, sessionUuid);
                onMessages(messages.data);
                finished = true;
                break;
            }

            if (item.event === 'error') {
                throw new ApiError(504, { message: String(data.message ?? 'Erreur SSE') });
            }
        }
    }

    if (!finished) {
        throw new ApiError(504, { message: 'Flux SSE interrompu.' });
    }
}

async function waitViaPolling(
    agentUuid: string,
    runUuid: string,
    sessionUuid: string,
    onMessages: (messages: AgentChatMessage[]) => void,
    onRouting?: (routing: AgentModelRouting) => void,
    onProgress?: (payload: StreamStatusPayload) => void,
): Promise<void> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));

        const run = await domainApi.agentRun(agentUuid, runUuid);
        if (run.data.metadata?.model_routing) {
            onRouting?.(run.data.metadata.model_routing);
        }
        const payload: StreamStatusPayload = {
            status: run.data.status,
            iterations: run.data.iterations,
            tokens_used: run.data.tokens_used,
            summary: run.data.summary,
            live_assistant_text: run.data.live_assistant_text ?? run.data.summary,
            active_subagent_count: run.data.active_subagent_count ?? 0,
            steps: run.data.metadata?.steps,
            model_routing: run.data.metadata?.model_routing ?? null,
        };
        notifySpotlight(payload);
        onProgress?.(payload);

        if (run.data.status === 'failed') {
            throw new ApiError(502, { message: run.data.summary ?? 'La réponse de l\'agent a échoué.' });
        }

        if (!isTerminalAgentRunStatus(run.data.status)) {
            continue;
        }

        const response = await domainApi.agentSessionMessages(agentUuid, sessionUuid);
        onMessages(response.data);

        return;
    }

    throw new ApiError(504, { message: 'Délai dépassé en attendant la réponse de l\'agent.' });
}
