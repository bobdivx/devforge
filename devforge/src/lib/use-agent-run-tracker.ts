import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { AgentRun } from '../lib/domain-api';
import { domainApi } from '../lib/domain-api';
import { ApiError } from '../lib/api-client';
import { isTerminalAgentRunStatus } from '../lib/agent-run-tracker';

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 120;

type RunOutcome = 'completed' | 'failed' | 'timeout' | null;

type Options = {
    onRefresh?: () => void;
};

export function useAgentRunTracker(agentUuid: string, options: Options = {}) {
    const { onRefresh } = options;
    const [isLaunching, setIsLaunching] = useState(false);
    const [isTracking, setIsTracking] = useState(false);
    const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
    const [runError, setRunError] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<RunOutcome>(null);
    const pollRef = useRef<number | null>(null);
    const attemptsRef = useRef(0);

    const stopPolling = useCallback(() => {
        if (pollRef.current !== null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const pollRun = useCallback((runUuid: string) => {
        stopPolling();
        attemptsRef.current = 0;
        setIsTracking(true);
        setOutcome(null);
        setRunError(null);

        const tick = async () => {
            attemptsRef.current += 1;

            try {
                const response = await domainApi.agentRun(agentUuid, runUuid);
                setActiveRun(response.data);
                onRefresh?.();

                if (isTerminalAgentRunStatus(response.data.status)) {
                    stopPolling();
                    setIsTracking(false);
                    setOutcome(response.data.status === 'completed' ? 'completed' : 'failed');

                    if (response.data.status === 'failed') {
                        setRunError(response.data.summary?.trim() || 'L\'exécution a échoué.');
                    }

                    return;
                }
            } catch (error) {
                stopPolling();
                setIsTracking(false);
                setRunError(error instanceof ApiError ? error.message : 'Impossible de suivre l\'exécution.');
                setOutcome('failed');
                return;
            }

            if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
                stopPolling();
                setIsTracking(false);
                setOutcome('timeout');
                setRunError('Délai dépassé — ouvrez les logs pour voir si l\'agent tourne encore.');
            }
        };

        void tick();
        pollRef.current = window.setInterval(() => {
            void tick();
        }, POLL_INTERVAL_MS);
    }, [agentUuid, onRefresh, stopPolling]);

    const launch = useCallback(async () => {
        setRunError(null);
        setOutcome(null);
        setActiveRun(null);
        setIsLaunching(true);
        setIsTracking(true);

        try {
            const response = await domainApi.runAgent(agentUuid);
            setIsLaunching(false);
            pollRun(response.data.run_uuid);
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
