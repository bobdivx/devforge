import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiError } from './api-client';
import { domainApi, type InstanceBackupExecution, type InstanceBackupSettings } from './domain-api';
import {
    findTrackedInstanceBackupExecution,
    instanceBackupPhaseLabel,
    isTerminalBackupStatus,
    resolveInstanceBackupPhase,
    type InstanceBackupPhase,
} from './instance-backup-tracker';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 180;

type Options = {
    onComplete?: (settings?: InstanceBackupSettings) => void;
};

export function useInstanceBackupTracker(options: Options = {}) {
    const { onComplete } = options;
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;

    const [isTracking, setIsTracking] = useState(false);
    const [execution, setExecution] = useState<InstanceBackupExecution | null>(null);
    const [phase, setPhase] = useState<InstanceBackupPhase>('queued');
    const [error, setError] = useState<string | null>(null);
    const pollRef = useRef<number | null>(null);
    const attemptsRef = useRef(0);
    const knownUuidsRef = useRef<Set<string>>(new Set());
    const trackingRef = useRef(false);

    const stopPolling = useCallback(() => {
        if (pollRef.current !== null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const finishTracking = useCallback(async (finalPhase: InstanceBackupPhase, finalError: string | null = null) => {
        stopPolling();
        trackingRef.current = false;
        setIsTracking(false);
        setPhase(finalPhase);
        setError(finalError);

        try {
            const response = await domainApi.instanceBackupSettings();
            onCompleteRef.current?.(response.data);
        } catch {
            onCompleteRef.current?.();
        }
    }, [stopPolling]);

    const startPolling = useCallback((knownUuids: Iterable<string>, current?: InstanceBackupExecution | null) => {
        stopPolling();
        knownUuidsRef.current = new Set(knownUuids);
        attemptsRef.current = 0;
        trackingRef.current = true;
        setIsTracking(true);
        setError(null);
        setPhase(current ? resolveInstanceBackupPhase(current) : 'queued');
        setExecution(current ?? null);

        const tick = async () => {
            attemptsRef.current += 1;

            try {
                const response = await domainApi.instanceBackupSettings();
                const tracked = findTrackedInstanceBackupExecution(response.data, knownUuidsRef.current);

                if (tracked && !knownUuidsRef.current.has(tracked.uuid)) {
                    setExecution(tracked);
                    setPhase(resolveInstanceBackupPhase(tracked));

                    if (isTerminalBackupStatus(tracked.status)) {
                        await finishTracking(
                            tracked.status === 'failed' ? 'failed' : 'completed',
                            tracked.status === 'failed' ? (tracked.message ?? 'La sauvegarde d’instance a échoué.') : null,
                        );

                        return;
                    }
                }
            } catch (pollError) {
                await finishTracking(
                    'failed',
                    pollError instanceof ApiError ? pollError.message : 'Impossible de suivre la sauvegarde d’instance.',
                );

                return;
            }

            if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
                await finishTracking(
                    'timeout',
                    'La sauvegarde prend plus de temps que prévu. Rechargez la page pour voir le résultat.',
                );
            }
        };

        void tick();
        pollRef.current = window.setInterval(() => {
            void tick();
        }, POLL_INTERVAL_MS);
    }, [finishTracking, stopPolling]);

    const startRun = useCallback(async (knownUuids: Iterable<string>) => {
        setError(null);
        trackingRef.current = true;
        setIsTracking(true);
        setPhase('queued');
        setExecution(null);

        try {
            await domainApi.runInstanceBackup();
            startPolling(knownUuids);
        } catch (startError) {
            trackingRef.current = false;
            setIsTracking(false);
            setPhase('failed');
            setError(startError instanceof ApiError ? startError.message : 'Impossible de lancer la sauvegarde d’instance.');
            throw startError;
        }
    }, [startPolling]);

    const resume = useCallback((active: InstanceBackupExecution, knownUuids: Iterable<string>) => {
        if (trackingRef.current) {
            return;
        }

        startPolling([...knownUuids].filter((uuid) => uuid !== active.uuid), active);
    }, [startPolling]);

    useEffect(() => () => stopPolling(), [stopPolling]);

    return {
        isTracking,
        execution,
        phase,
        phaseLabel: instanceBackupPhaseLabel(phase),
        error,
        startRun,
        resume,
        stopPolling,
    };
}
