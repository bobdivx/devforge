import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useTeamContext } from './team-context';

export type ApiQueryState<T> = {
    data: T | null;
    loading: boolean;
    error: unknown;
    reload: (options?: { silent?: boolean }) => Promise<void>;
};

export function useApiQuery<T>(
    key: string | null,
    request: () => Promise<T>,
): ApiQueryState<T> {
    const { revision } = useTeamContext();
    const requestRef = useRef(request);
    requestRef.current = request;
    const cacheKey = key === null ? null : `${key}::team:${revision}`;
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(cacheKey !== null);
    const [error, setError] = useState<unknown>(null);
    const requestIdRef = useRef(0);

    const reload = useCallback(async (options?: { silent?: boolean }) => {
        if (cacheKey === null) {
            requestIdRef.current += 1;
            setData(null);
            setLoading(false);
            setError(null);
            return;
        }

        const requestId = ++requestIdRef.current;

        if (!options?.silent) {
            setLoading(true);
            setError(null);
        }

        try {
            const nextData = await requestRef.current();
            if (requestId !== requestIdRef.current) {
                return;
            }
            setData(nextData);
            if (options?.silent) {
                setError(null);
            }
        } catch (requestError) {
            if (requestId !== requestIdRef.current) {
                return;
            }
            if (!options?.silent) {
                setData(null);
            }
            setError(requestError);
        } finally {
            if (requestId !== requestIdRef.current) {
                return;
            }
            if (!options?.silent) {
                setLoading(false);
            }
        }
    }, [cacheKey]);

    useEffect(() => {
        setData(null);
        void reload();
    }, [reload]);

    return { data, loading, error, reload };
}
