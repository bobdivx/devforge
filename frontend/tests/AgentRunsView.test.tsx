import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRunsView } from '../src/components/agents/AgentRunsView';
import type { Agent, AgentRun } from '../src/lib/domain-api';
import { domainApi } from '../src/lib/domain-api';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const mockAgent = {
    id: 1,
    uuid: 'agent-01',
    name: 'Agent Débogage',
    type: 'debug',
    avatar_color: '#3b82f6',
    avatar_shape: 'circle',
    status: 'idle',
    is_active: true,
} as Agent;

const mockRun1: AgentRun = {
    uuid: 'run-01',
    status: 'completed',
    trigger: 'manual',
    summary: 'Analyse terminée avec succès.',
    actions_taken: [],
    tokens_used: 120,
    iterations: 2,
    duration_seconds: 5,
    created_at: '2026-08-24T08:00:00.000Z',
    started_at: '2026-08-24T08:00:01.000Z',
    finished_at: '2026-08-24T08:00:06.000Z',
};

const mockRun2: AgentRun = {
    uuid: 'run-02',
    status: 'failed',
    trigger: 'scheduled',
    summary: 'Erreur: Timeout API',
    actions_taken: [],
    tokens_used: 80,
    iterations: 1,
    duration_seconds: 3,
    created_at: '2026-08-24T08:10:00.000Z',
    started_at: '2026-08-24T08:10:01.000Z',
    finished_at: '2026-08-24T08:10:04.000Z',
};

describe('AgentRunsView', () => {
    beforeEach(() => {
        vi.spyOn(domainApi, 'agentRuns').mockResolvedValue({
            data: [mockRun1, mockRun2],
            meta: { total: 2, per_page: 20, current_page: 1, last_page: 1 },
        });
        vi.spyOn(domainApi, 'agentRun').mockResolvedValue({
            data: mockRun1,
        });
        vi.spyOn(domainApi, 'clearAgentRuns').mockResolvedValue({
            data: { cleared: 2 },
        });
        vi.spyOn(domainApi, 'deleteAgentRun').mockResolvedValue({
            data: { deleted: true },
        });
    });

    it('affiche le bouton Purger tout quand des runs sont présents', async () => {
        render(
            <AgentRunsView
                agent={mockAgent}
                onAgentUpdated={() => {}}
            />,
        );

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Purger tout/i })).toBeTruthy();
        });
    });

    it('purges all runs upon confirmation', async () => {
        const onAgentUpdated = vi.fn();
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

        render(
            <AgentRunsView
                agent={mockAgent}
                onAgentUpdated={onAgentUpdated}
            />,
        );

        const purgeButton = await screen.findByRole('button', { name: /Purger tout/i });
        fireEvent.click(purgeButton);

        expect(confirmSpy).toHaveBeenCalled();
        await waitFor(() => {
            expect(domainApi.clearAgentRuns).toHaveBeenCalledWith('agent-01');
            expect(onAgentUpdated).toHaveBeenCalled();
        });

        // After purge, runs list is empty
        await waitFor(() => {
            expect(screen.getByText(/Aucune exécution pour l'instant/i)).toBeTruthy();
        });
    });

    it('does not purge if confirmation is cancelled', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);

        render(
            <AgentRunsView
                agent={mockAgent}
                onAgentUpdated={() => {}}
            />,
        );

        const purgeButton = await screen.findByRole('button', { name: /Purger tout/i });
        fireEvent.click(purgeButton);

        expect(domainApi.clearAgentRuns).not.toHaveBeenCalled();
        expect(screen.queryByText(/Aucune exécution pour l'instant/i)).toBeNull();
    });

    it('deletes a single run when clicking delete on a run row', async () => {
        const onAgentUpdated = vi.fn();
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        render(
            <AgentRunsView
                agent={mockAgent}
                onAgentUpdated={onAgentUpdated}
            />,
        );

        const deleteButtons = await screen.findAllByRole('button', { name: /Supprimer run/i });
        expect(deleteButtons.length).toBe(2);

        fireEvent.click(deleteButtons[0]);

        await waitFor(() => {
            expect(domainApi.deleteAgentRun).toHaveBeenCalledWith('agent-01', 'run-01');
            expect(onAgentUpdated).toHaveBeenCalled();
        });
    });
});
