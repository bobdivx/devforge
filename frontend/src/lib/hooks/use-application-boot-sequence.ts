import { useEffect, useState } from 'preact/hooks';
import { domainApi, type ApplicationBootSequence } from '../domain-api';
import { useTeamContext } from '../team-context';

const idleSequence: ApplicationBootSequence = {
    active: false,
    status: 'idle',
    started_at: null,
    finished_at: null,
    current_uuid: null,
    completed: 0,
    total: 0,
    poll_interval_ms: 2500,
    items: [],
};

export function useApplicationBootSequence(enabled: boolean) {
    const { revision } = useTeamContext();
    const [sequence, setSequence] = useState<ApplicationBootSequence>(idleSequence);

    useEffect(() => {
        if (!enabled) {
            setSequence(idleSequence);
            return;
        }

        let cancelled = false;
        let timer: number | null = null;

        const poll = async () => {
            try {
                const response = await domainApi.applicationBootSequence();
                if (cancelled) {
                    return;
                }

                setSequence(response.data);

                const delay = response.data.active
                    ? Math.max(1000, response.data.poll_interval_ms || 2500)
                    : 15000;

                timer = window.setTimeout(() => {
                    void poll();
                }, delay);
            } catch {
                if (cancelled) {
                    return;
                }

                timer = window.setTimeout(() => {
                    void poll();
                }, 10000);
            }
        };

        void poll();

        return () => {
            cancelled = true;
            if (timer !== null) {
                window.clearTimeout(timer);
            }
        };
    }, [enabled, revision]);

    return sequence;
}
