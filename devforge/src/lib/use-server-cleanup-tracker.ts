import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiError } from './api-client';
import { domainApi, type ServerStorageExecution, type ServerStorageSummary } from './domain-api';
import {
    cleanupPhaseLabel,
    isTerminalCleanupStatus,
    resolveCleanupPhase,
    type ServerCleanupPhase,
} from './server-cleanup-tracker';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300;

type Options = {
    onComplete?: (server?: ServerStorageSummary) => void;
};

export function useServerCleanupTracker(serverUuid: string, options: Options = {}) {
    const { onComplete } = options;
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;

    const [isTracking, setIsTracking] = useState(false);
    const [execution, setExecution] = useState<ServerStorageExecution | null>(null);
    const [phase, setPhase] = useState<ServerCleanupPhase>('queued');
    const [error, setError] = useState<string | null>(null);
    const pollRef = useRef<number | null>(null);
    const attemptsRef = useRef(0);
    const executionIdRef = useRef<number | null>(null);

    const stopPolling = useCallback(() => {
        if (pollRef.current !== null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const finishTracking = useCallback(async () => {
        stopPolling();
        setIsTracking(false);

        try {
            const [storageResponse, diskResponse] = await Promise.all([
                domainApi.serverStorage(serverUuid, false),
                domainApi.refreshServerDiskUsage(serverUuid),
            ]);

            const updated: ServerStorageSummary = {
                ...storageResponse.data,
                disk_usage_percent: diskResponse.data.disk_usage_percent,
            };

            onCompleteRef.current?.(updated);
        } catch {
            onCompleteRef.current?.();
        }
    }, [serverUuid, stopPolling]);

    const pollExecution = useCallback((executionId: number) => {
        stopPolling();
        executionIdRef.current = executionId;
        attemptsRef.current = 0;
        setIsTracking(true);
        setError(null);
        setPhase('queued');
        setExecution(null);

        const tick = async () => {
            attemptsRef.current += 1;

            try {
                const response = await domainApi.serverStorage(serverUuid, false);
                const current = response.data.executions?.find((item) => item.id === executionId)
                    ?? (response.data.last_cleanup?.id === executionId ? response.data.last_cleanup : null);

                if (current) {
                    setExecution(current);
                    setPhase(resolveCleanupPhase(current));

                    if (isTerminalCleanupStatus(current.status)) {
                        await finishTracking();

                        if (current.status === 'failed') {
                            setError(current.message ?? 'Le nettoyage Docker a échoué.');
                        }

                        return;
                    }
                }
            } catch (pollError) {
                stopPolling();
                setIsTracking(false);
                setPhase('failed');
                setError(pollError instanceof ApiError ? pollError.message : 'Impossible de suivre le nettoyage.');
                onCompleteRef.current?.();

                return;
            }

            if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
                stopPolling();
                setIsTracking(false);
                setPhase('timeout');
                setError('Le nettoyage prend plus de temps que prévu. Rechargez la page pour voir le résultat.');
                onCompleteRef.current?.();
            }
        };

        void tick();
        pollRef.current = window.setInterval(() => {
            void tick();
        }, POLL_INTERVAL_MS);
    }, [finishTracking, serverUuid, stopPolling]);

    const startCleanup = useCallback(async (input?: {
        delete_unused_volumes?: boolean;
        delete_unused_networks?: boolean;
        force_docker_cleanup?: boolean;
        disable_application_image_retention?: boolean;
        aggressive?: boolean;
    }) => {
        setError(null);
        setIsTracking(true);
        setPhase('queued');

        try {
            const response = await domainApi.runServerStorageCleanup(serverUuid, input);
            pollExecution(response.data.execution_id);
        } catch (startError) {
            setIsTracking(false);
            setPhase('failed');
            setError(startError instanceof ApiError ? startError.message : 'Impossible de lancer le nettoyage Docker.');
        }
    }, [pollExecution, serverUuid]);

    useEffect(() => () => stopPolling(), [stopPolling]);

    return {
        isTracking,
        execution,
        phase,
        phaseLabel: cleanupPhaseLabel(phase),
        error,
        startCleanup,
        stopPolling,
    };
}
