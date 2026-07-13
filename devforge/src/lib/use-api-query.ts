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

    const reload = useCallback(async (options?: { silent?: boolean }) => {
        if (cacheKey === null) {
            setData(null);
            setLoading(false);
            return;
        }

        if (!options?.silent) {
            setLoading(true);
            setError(null);
        }

        try {
            setData(await requestRef.current());
            if (options?.silent) {
                setError(null);
            }
        } catch (requestError) {
            if (!options?.silent) {
                setData(null);
            }
            setError(requestError);
        } finally {
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
