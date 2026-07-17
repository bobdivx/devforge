import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { domainApi, type DeploymentLog } from '../api/domain';

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
    options?: { enabled?: boolean; intervalMs?: number; debugKey?: boolean },
): DeploymentLogsState {
    const enabled = options?.enabled !== false && deploymentUuid !== null;
    const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    const debugKey = options?.debugKey ?? false;
    const [lines, setLines] = useState<DeploymentLog[]>([]);
    const [complete, setComplete] = useState(false);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<unknown>(null);
    const cursorRef = useRef(0);
    const completeRef = useRef(false);
    const inFlightRef = useRef(false);
    const generationRef = useRef(0);
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
            generationRef.current += 1;
            cursorRef.current = 0;
            completeRef.current = false;
            inFlightRef.current = false;
            setLines([]);
            setComplete(false);
            setLoading(true);
            setError(null);
        } else if (inFlightRef.current || completeRef.current) {
            return;
        }

        const generation = generationRef.current;
        const requestUuid = uuid;
        inFlightRef.current = true;

        try {
            const after = reset ? 0 : cursorRef.current;
            const response = await domainApi.deploymentLogs(requestUuid, after);

            // Ignore stale responses from a previous deployment / reset.
            if (generation !== generationRef.current || deploymentRef.current !== requestUuid) {
                return;
            }

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
            if (generation !== generationRef.current || deploymentRef.current !== requestUuid) {
                return;
            }

            if (reset) {
                setLines([]);
            }
            setError(requestError);
        } finally {
            if (generation === generationRef.current) {
                inFlightRef.current = false;

                if (reset) {
                    setLoading(false);
                }
            }
        }
    }, []);

    const reload = useCallback(async () => {
        await fetchLogs(true);
    }, [fetchLogs]);

    useEffect(() => {
        if (!enabled || !deploymentUuid) {
            generationRef.current += 1;
            setLines([]);
            setComplete(false);
            setLoading(false);
            return;
        }

        void fetchLogs(true);
    }, [deploymentUuid, enabled, debugKey, fetchLogs]);

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
