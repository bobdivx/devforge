import { render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { useEffect } from 'preact/hooks';
import { TeamContext } from '../src/lib/team-context';
import { useApiQuery } from '../src/lib/use-api-query';

function Probe() {
    const query = useApiQuery('probe', async () => ({ revision: 'loaded' }));
    if (query.loading) return <span>loading</span>;
    if (query.error) return <span>error</span>;
    return <span>{query.data?.revision ?? 'empty'}</span>;
}

function SilentReloadProbe() {
    const query = useApiQuery('silent-probe', async () => ({ revision: 'loaded' }));

    useEffect(() => {
        if (query.data) {
            void query.reload({ silent: true });
        }
    }, [query.data, query.reload]);

    if (query.loading) return <span>loading</span>;
    return <span>{query.data?.revision ?? 'empty'}</span>;
}

describe('useApiQuery team invalidation', () => {
    it('recharge les données quand la révision équipe change', async () => {
        const { rerender } = render(
            <TeamContext.Provider value={{ teamId: 1, revision: 0, agentsEnabled: false }}>
                <Probe />
            </TeamContext.Provider>,
        );

        expect(await screen.findByText('loaded')).toBeInTheDocument();

        rerender(
            <TeamContext.Provider value={{ teamId: 2, revision: 1, agentsEnabled: false }}>
                <Probe />
            </TeamContext.Provider>,
        );

        expect(await screen.findByText('loading')).toBeInTheDocument();
        expect(await screen.findByText('loaded')).toBeInTheDocument();
    });

    it('ne repasse pas en loading lors d’un reload silencieux', async () => {
        render(
            <TeamContext.Provider value={{ teamId: 1, revision: 0, agentsEnabled: false }}>
                <SilentReloadProbe />
            </TeamContext.Provider>,
        );

        expect(await screen.findByText('loaded')).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.queryByText('loading')).not.toBeInTheDocument();
        });
    });
});
