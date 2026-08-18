import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiError } from './api-client';
import { domainApi, type InstanceUpgradeStatus } from './domain-api';
import {
    checkInstanceHealth,
    INSTANCE_UPGRADE_CHANGED_EVENT,
    INSTANCE_UPGRADE_SUCCESS_COUNTDOWN,
    instanceUpgradeReviveMessage,
    instanceUpgradeUiStep,
} from './instance-upgrade';

const IDLE_POLL_MS = 60_000;
const ACTIVE_POLL_MS = 2_000;

export type InstanceUpgradePhase = 'idle' | 'progress' | 'reviving' | 'complete' | 'error';

type Options = {
    enabled: boolean;
    onReload?: () => void;
    checkHealth?: () => Promise<boolean>;
};

export function useInstanceUpgrade({
    enabled,
    onReload,
    checkHealth = checkInstanceHealth,
}: Options) {
    const [status, setStatus] = useState<InstanceUpgradeStatus | null>(null);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [unreachable, setUnreachable] = useState(false);
    const [complete, setComplete] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [healthCheckAttempts, setHealthCheckAttempts] = useState(0);
    const [successCountdown, setSuccessCountdown] = useState<number | null>(null);
    const pollRef = useRef<number | null>(null);
    const startedAtRef = useRef<number | null>(null);
    const observedProgressRef = useRef(false);
    const completeRef = useRef(false);
    const statusRef = useRef<InstanceUpgradeStatus | null>(null);
    const onReloadRef = useRef(onReload);
    const checkHealthRef = useRef(checkHealth);
    const tickRef = useRef<() => Promise<void>>(async () => undefined);

    onReloadRef.current = onReload;
    checkHealthRef.current = checkHealth;

    const stopPolling = useCallback(() => {
        if (pollRef.current !== null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const reloadNow = useCallback(() => {
        const reloadPage = onReloadRef.current ?? (() => window.location.reload());
        reloadPage();
    }, []);

    const beginComplete = useCallback(() => {
        if (completeRef.current) {
            return;
        }

        completeRef.current = true;
        setUnreachable(false);
        setComplete(true);
        setSuccessCountdown(INSTANCE_UPGRADE_SUCCESS_COUNTDOWN);
    }, []);

    const applyStatus = useCallback((next: InstanceUpgradeStatus) => {
        if (next.status === 'none' && observedProgressRef.current && !completeRef.current) {
            return;
        }

        setStatus(next);
        statusRef.current = next;
        setUnreachable(false);

        if (next.status === 'in_progress') {
            observedProgressRef.current = true;
        }

        if (next.status === 'complete' && observedProgressRef.current) {
            beginComplete();
        }
    }, [beginComplete]);

    const reload = useCallback(async (silent = false) => {
        if (!enabled) {
            setStatus(null);
            setError(null);
            setUnreachable(false);
            return;
        }

        try {
            const response = await domainApi.instanceUpgradeStatus();
            applyStatus(response.data);
            if (!silent) {
                setError(null);
            }
        } catch (caught) {
            if (silent && observedProgressRef.current && !completeRef.current) {
                setUnreachable(true);
                setHealthCheckAttempts((current) => current + 1);
                const healthy = await checkHealthRef.current();
                if (healthy) {
                    beginComplete();
                }
                return;
            }

            if (!silent) {
                setStatus(null);
                setError(caught instanceof ApiError ? caught.message : 'Impossible de vérifier les mises à jour.');
            }
        }
    }, [applyStatus, beginComplete, enabled]);

    tickRef.current = () => reload(true);

    const start = useCallback(async () => {
        setStarting(true);
        setError(null);
        observedProgressRef.current = true;
        startedAtRef.current = Date.now();
        setElapsedSeconds(0);

        try {
            const response = await domainApi.startInstanceUpgrade();
            applyStatus(response.data);
        } catch (caught) {
            if (statusRef.current?.status !== 'in_progress') {
                observedProgressRef.current = false;
            }
            const message = caught instanceof ApiError ? caught.message : 'Impossible de lancer la mise à jour.';
            setError(message);
            throw caught;
        } finally {
            setStarting(false);
        }
    }, [applyStatus]);

    useEffect(() => {
        if (!enabled) {
            setStatus(null);
            setError(null);
            setUnreachable(false);
            return;
        }

        void reload();
    }, [enabled, reload]);

    useEffect(() => {
        if (!enabled) {
            return;
        }

        const onChanged = () => {
            void reload(true);
        };

        window.addEventListener(INSTANCE_UPGRADE_CHANGED_EVENT, onChanged);
        return () => window.removeEventListener(INSTANCE_UPGRADE_CHANGED_EVENT, onChanged);
    }, [enabled, reload]);

    const phase: InstanceUpgradePhase = complete
        ? 'complete'
        : unreachable
            ? 'reviving'
            : starting || status?.status === 'in_progress'
                ? 'progress'
                : status?.status === 'error'
                    ? 'error'
                    : 'idle';

    useEffect(() => {
        if (!enabled || complete) {
            stopPolling();
            return;
        }

        const interval = status?.status === 'in_progress' || unreachable ? ACTIVE_POLL_MS : IDLE_POLL_MS;
        stopPolling();
        pollRef.current = window.setInterval(() => {
            void tickRef.current();
        }, interval);

        return stopPolling;
    }, [complete, enabled, status?.status, stopPolling, unreachable]);

    useEffect(() => {
        const running = starting || status?.status === 'in_progress' || unreachable;
        if (!running || complete) {
            return;
        }

        if (startedAtRef.current === null) {
            startedAtRef.current = Date.now();
        }

        const timer = window.setInterval(() => {
            setElapsedSeconds(Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000));
        }, 1000);

        return () => window.clearInterval(timer);
    }, [complete, starting, status?.status, unreachable]);

    useEffect(() => {
        if (!complete) {
            return;
        }

        const timer = window.setInterval(() => {
            setSuccessCountdown((current) => {
                const next = (current ?? 1) - 1;
                if (next <= 0) {
                    window.clearInterval(timer);
                    reloadNow();
                    return 0;
                }

                return next;
            });
        }, 1000);

        return () => window.clearInterval(timer);
    }, [complete, reloadNow]);

    useEffect(() => {
        if (phase !== 'progress' && phase !== 'reviving') {
            return;
        }

        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [phase]);

    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    const message = complete
        ? `Mise à jour vers ${status?.latest_version ?? 'la nouvelle version'} réussie`
        : unreachable
            ? instanceUpgradeReviveMessage(elapsedMinutes, Math.max(1, healthCheckAttempts))
            : status?.message ?? (starting ? 'Démarrage de la mise à jour…' : null);

    const uiStep = instanceUpgradeUiStep({
        status,
        unreachable,
        complete,
        starting,
    });

    return {
        status,
        starting,
        error,
        start,
        reload,
        phase,
        message,
        uiStep,
        elapsedSeconds,
        successCountdown,
        healthCheckAttempts,
        reloadNow,
    };
}
