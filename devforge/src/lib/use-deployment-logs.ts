import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { domainApi, type DeploymentLog } from './domain-api';

const DEFAULT_INTERVAL_MS = 2000;

export type DeploymentLogsState = {
    lines: DeploymentLog[];
    complete: boolean;
    loading: boolean;
    error: unknown;
    reload: () => Promise<void>;
};

export function useDeploymentLogs(
    deploymentUuid: string | null,
    options?: { enabled?: boolean; intervalMs?: number },
): DeploymentLogsState {
    const enabled = options?.enabled !== false && deploymentUuid !== null;
    const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    const [lines, setLines] = useState<DeploymentLog[]>([]);
    const [complete, setComplete] = useState(false);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<unknown>(null);
    const cursorRef = useRef(0);
    const completeRef = useRef(false);
    const inFlightRef = useRef(false);
    const deploymentRef = useRef(deploymentUuid);
    deploymentRef.current = deploymentUuid;

    const fetchLogs = useCallback(async (reset = false) => {
        const uuid = deploymentRef.current;

        if (!uuid) {
            setLines([]);
            setComplete(false);
            setLoading(false);
            return;
        }

        if (reset) {
            cursorRef.current = 0;
            completeRef.current = false;
            setLines([]);
            setComplete(false);
            setLoading(true);
            setError(null);
        } else if (inFlightRef.current || completeRef.current) {
            return;
        }

        inFlightRef.current = true;

        try {
            const after = reset ? 0 : cursorRef.current;
            const response = await domainApi.deploymentLogs(uuid, after);
            const payload = response.data;

            setLines((current) => {
                if (reset) {
                    return payload.items;
                }

                const existing = new Set(current.map((line) => line.cursor));

                return [
                    ...current,
                    ...payload.items.filter((line) => !existing.has(line.cursor)),
                ];
            });
            cursorRef.current = payload.next_cursor;
            completeRef.current = payload.complete;
            setComplete(payload.complete);
            setError(null);
        } catch (requestError) {
            if (reset) {
                setLines([]);
            }
            setError(requestError);
        } finally {
            inFlightRef.current = false;

            if (reset) {
                setLoading(false);
            }
        }
    }, []);

    const reload = useCallback(async () => {
        await fetchLogs(true);
    }, [fetchLogs]);

    useEffect(() => {
        if (!enabled || !deploymentUuid) {
            setLines([]);
            setComplete(false);
            setLoading(false);
            return;
        }

        void fetchLogs(true);
    }, [deploymentUuid, enabled, fetchLogs]);

    useEffect(() => {
        if (!enabled || !deploymentUuid || complete) {
            return;
        }

        let cancelled = false;
        let timeoutId = 0;

        const schedulePoll = () => {
            timeoutId = window.setTimeout(() => {
                void fetchLogs(false).finally(() => {
                    if (!cancelled && !completeRef.current) {
                        schedulePoll();
                    }
                });
            }, intervalMs);
        };

        schedulePoll();

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [complete, deploymentUuid, enabled, fetchLogs, intervalMs]);

    return {
        lines,
        complete,
        loading,
        error,
        reload,
    };
}
