import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { AgentRun } from '../lib/domain-api';
import { domainApi } from '../lib/domain-api';
import { ApiError } from '../lib/api-client';
import { isTerminalAgentRunStatus } from '../lib/agent-run-tracker';

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 120;

type RunOutcome = 'completed' | 'failed' | 'timeout' | null;

type Options = {
    /** Called on each poll tick while the run is active */
    onPoll?: () => void;
    /** Called when the run reaches a terminal status (or on poll error / timeout) */
    onComplete?: () => void;
};

export function useAgentRunTracker(agentUuid: string, options: Options = {}) {
    const { onPoll, onComplete } = options;
    const onPollRef = useRef(onPoll);
    const onCompleteRef = useRef(onComplete);
    onPollRef.current = onPoll;
    onCompleteRef.current = onComplete;
    const [isLaunching, setIsLaunching] = useState(false);
    const [isTracking, setIsTracking] = useState(false);
    const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
    const [runError, setRunError] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<RunOutcome>(null);
    const pollRef = useRef<number | null>(null);
    const attemptsRef = useRef(0);
    const trackingRunRef = useRef<string | null>(null);
    const settledRunRef = useRef<string | null>(null);

    const stopPolling = useCallback(() => {
        if (pollRef.current !== null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const pollRun = useCallback((runUuid: string, options?: { force?: boolean }) => {
        // Avoid restarting the same in-flight poll (prevents card flicker).
        if (!options?.force && trackingRunRef.current === runUuid && pollRef.current !== null) {
            return;
        }

        // A finished run must not be re-tracked when parent props are still stale.
        if (!options?.force && settledRunRef.current === runUuid) {
            return;
        }

        stopPolling();
        attemptsRef.current = 0;
        trackingRunRef.current = runUuid;
        settledRunRef.current = null;
        setIsTracking(true);
        setOutcome(null);
        setRunError(null);

        const tick = async () => {
            attemptsRef.current += 1;

            try {
                const response = await domainApi.agentRun(agentUuid, runUuid);
                setActiveRun(response.data);
                onPollRef.current?.();

                if (isTerminalAgentRunStatus(response.data.status)) {
                    stopPolling();
                    trackingRunRef.current = null;
                    settledRunRef.current = runUuid;
                    setIsTracking(false);
                    setOutcome(response.data.status === 'completed' ? 'completed' : 'failed');

                    if (response.data.status === 'failed') {
                        setRunError(response.data.summary?.trim() || 'L\'exécution a échoué.');
                    }

                    onCompleteRef.current?.();

                    return;
                }
            } catch (error) {
                stopPolling();
                trackingRunRef.current = null;
                settledRunRef.current = runUuid;
                setIsTracking(false);
                setRunError(error instanceof ApiError ? error.message : 'Impossible de suivre l\'exécution.');
                setOutcome('failed');
                onCompleteRef.current?.();

                return;
            }

            if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
                stopPolling();
                trackingRunRef.current = null;
                settledRunRef.current = runUuid;
                setIsTracking(false);
                setOutcome('timeout');
                setRunError('Délai dépassé — ouvrez les logs pour voir si l\'agent tourne encore.');
                onCompleteRef.current?.();
            }
        };

        void tick();
        pollRef.current = window.setInterval(() => {
            void tick();
        }, POLL_INTERVAL_MS);
    }, [agentUuid, stopPolling]);

    const launch = useCallback(async () => {
        setRunError(null);
        setOutcome(null);
        setActiveRun(null);
        settledRunRef.current = null;
        trackingRunRef.current = null;
        setIsLaunching(true);
        setIsTracking(true);

        try {
            const response = await domainApi.runAgent(agentUuid);
            setIsLaunching(false);
            pollRun(response.data.run_uuid, { force: true });
        } catch (error) {
            setIsLaunching(false);
            setIsTracking(false);
            setRunError(error instanceof ApiError ? error.message : 'Impossible de lancer l\'agent.');
            setOutcome('failed');
        }
    }, [agentUuid, pollRun]);

    const trackExistingRun = useCallback((runUuid: string) => {
        pollRun(runUuid);
    }, [pollRun]);

    const resetFeedback = useCallback(() => {
        setOutcome(null);
        setRunError(null);
    }, []);

    useEffect(() => () => stopPolling(), [stopPolling]);

    useEffect(() => {
        stopPolling();
        trackingRunRef.current = null;
        settledRunRef.current = null;
        setIsLaunching(false);
        setIsTracking(false);
        setActiveRun(null);
        setRunError(null);
        setOutcome(null);
    }, [agentUuid, stopPolling]);

    return {
        isLaunching,
        isTracking,
        activeRun,
        runError,
        outcome,
        launch,
        trackExistingRun,
        resetFeedback,
        stopPolling,
    };
}
