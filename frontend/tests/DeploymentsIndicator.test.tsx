import { cleanup, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeploymentsIndicator } from '../src/components/DeploymentsIndicator';
import { domainApi, type Deployment } from '../src/lib/domain-api';
import { TeamContext } from '../src/lib/team-context';

afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty('--devforge-fab-clearance');
    vi.restoreAllMocks();
});

const activeDeployment: Deployment = {
    uuid: 'dep-1',
    status: 'in_progress',
    pull_request_id: 0,
    commit: null,
    commit_message: null,
    force_rebuild: false,
    rollback: false,
    created_at: '2026-08-10T10:00:00Z',
    updated_at: '2026-08-10T10:00:00Z',
    finished_at: null,
    application: { uuid: 'app-1', name: 'App' },
    is_debug_enabled: false,
};

describe('DeploymentsIndicator', () => {
    it('réserve de l’espace bas pour le FAB mobile quand un déploiement est actif', async () => {
        vi.spyOn(domainApi, 'deployments').mockResolvedValue({
            data: [activeDeployment],
            links: { first: null, last: null, prev: null, next: null },
            meta: {
                current_page: 1,
                from: 1,
                last_page: 1,
                path: '/api',
                per_page: 50,
                to: 1,
                total: 1,
            },
        } as Awaited<ReturnType<typeof domainApi.deployments>>);

        render(
            <TeamContext.Provider value={{ teamId: 1, revision: 0, agentsEnabled: true }}>
                <DeploymentsIndicator />
            </TeamContext.Provider>,
        );

        await waitFor(() => {
            expect(document.documentElement.style.getPropertyValue('--devforge-fab-clearance')).toBe('5.5rem');
        });
    });
});
