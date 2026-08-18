import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { useEffect, useState } from 'preact/hooks';
import { TeamContext } from '../src/lib/team-context';
import { useApiQuery } from '../src/lib/use-api-query';

function Probe() {
    const query = useApiQuery('probe', async () => ({ revision: 'loaded' }));
    if (query.loading) return <span>loading</span>;
    if (query.error) return <span>error</span>;
    return <span>{query.data?.revision ?? 'empty'}</span>;
}

function RaceProbe({ app }: { app: 'tesla' | 'starbase' }) {
    const query = useApiQuery(`deployments:${app}`, async () => {
        if (app === 'tesla') {
            await new Promise((resolve) => window.setTimeout(resolve, 40));
            return { app: 'tesla' };
        }

        return { app: 'starbase' };
    });

    if (query.loading) return <span>loading</span>;
    return <span>{query.data?.app ?? 'empty'}</span>;
}

function RaceHarness() {
    const [app, setApp] = useState<'tesla' | 'starbase'>('tesla');

    useEffect(() => {
        const timer = window.setTimeout(() => setApp('starbase'), 5);
        return () => window.clearTimeout(timer);
    }, []);

    return <RaceProbe app={app} />;
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

function SilentReloadDuringInitialLoadProbe() {
    const query = useApiQuery('silent-during-load', async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 40));
        return { revision: 'loaded' };
    });

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void query.reload({ silent: true });
        }, 5);

        return () => window.clearTimeout(timer);
    }, [query.reload]);

    if (query.loading) return <span>loading</span>;
    return <span>{query.data?.revision ?? 'empty'}</span>;
}

describe('useApiQuery team invalidation', () => {
    afterEach(() => {
        cleanup();
    });

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

    it('termine le chargement si un reload silencieux interrompt la requête initiale', async () => {
        render(
            <TeamContext.Provider value={{ teamId: 1, revision: 0, agentsEnabled: false }}>
                <SilentReloadDuringInitialLoadProbe />
            </TeamContext.Provider>,
        );

        expect(screen.getByText('loading')).toBeInTheDocument();
        expect(await screen.findByText('loaded', {}, { timeout: 500 })).toBeInTheDocument();
        expect(screen.queryByText('loading')).not.toBeInTheDocument();
    });

    it('ignore la réponse obsolète quand la clé change rapidement', async () => {
        render(
            <TeamContext.Provider value={{ teamId: 1, revision: 0, agentsEnabled: false }}>
                <RaceHarness />
            </TeamContext.Provider>,
        );

        expect(await screen.findByText('starbase')).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.queryByText('tesla')).not.toBeInTheDocument();
        }, { timeout: 200 });
    });
});
