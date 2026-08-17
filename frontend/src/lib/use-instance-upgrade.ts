import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiError } from './api-client';
import { domainApi, type InstanceUpgradeStatus } from './domain-api';

const IDLE_POLL_MS = 60_000;
const ACTIVE_POLL_MS = 2_000;

type Options = {
    enabled: boolean;
};

export function useInstanceUpgrade({ enabled }: Options) {
    const [status, setStatus] = useState<InstanceUpgradeStatus | null>(null);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pollRef = useRef<number | null>(null);

    const stopPolling = useCallback(() => {
        if (pollRef.current !== null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const reload = useCallback(async (silent = false) => {
        if (!enabled) {
            setStatus(null);
            setError(null);
            return;
        }

        try {
            const response = await domainApi.instanceUpgradeStatus();
            setStatus(response.data);
            if (!silent) {
                setError(null);
            }
        } catch (caught) {
            if (!silent) {
                setStatus(null);
                setError(caught instanceof ApiError ? caught.message : 'Impossible de vérifier les mises à jour.');
            }
        }
    }, [enabled]);

    const start = useCallback(async () => {
        setStarting(true);
        setError(null);

        try {
            const response = await domainApi.startInstanceUpgrade();
            setStatus(response.data);
        } catch (caught) {
            const message = caught instanceof ApiError ? caught.message : 'Impossible de lancer la mise à jour.';
            setError(message);
            throw caught;
        } finally {
            setStarting(false);
        }
    }, []);

    useEffect(() => {
        if (!enabled) {
            setStatus(null);
            setError(null);
            return;
        }

        void reload();
    }, [enabled, reload]);

    useEffect(() => {
        if (!enabled) {
            stopPolling();
            return;
        }

        const interval = status?.status === 'in_progress' ? ACTIVE_POLL_MS : IDLE_POLL_MS;
        stopPolling();
        pollRef.current = window.setInterval(() => {
            void reload(true);
        }, interval);

        return stopPolling;
    }, [enabled, reload, status?.status, stopPolling]);

    return {
        status,
        starting,
        error,
        start,
        reload,
    };
}
