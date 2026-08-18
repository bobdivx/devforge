import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamContext } from '../src/lib/team-context';
import { DEFAULT_AUTOMATION_NAME } from '../src/lib/agent-automations';
import { AutomationPage } from '../src/pages/automation/_AutomationPage';
import type { Agent } from '../src/lib/domain-api';

const agents = vi.fn();
const createAgent = vi.fn();
const createAgentStandingOrder = vi.fn();
const updateAgent = vi.fn();

vi.mock('../src/lib/domain-api', () => ({
    domainApi: {
        agents: (...args: unknown[]) => agents(...args),
        createAgent: (...args: unknown[]) => createAgent(...args),
        createAgentStandingOrder: (...args: unknown[]) => createAgentStandingOrder(...args),
        updateAgent: (...args: unknown[]) => updateAgent(...args),
    },
}));

function scheduledAgent(overrides: Partial<Agent> = {}): Agent {
    return {
        id: 1,
        uuid: 'agent-health',
        type: 'tech-watch',
        name: DEFAULT_AUTOMATION_NAME,
        description: 'Scan du matin',
        avatar_color: '#6366f1',
        system_prompt: null,
        schedule_minutes: 0,
        schedule_cron: '0 9 * * 1-5',
        trigger_mode: 'cron',
        is_active: true,
        status: 'idle',
        last_run_at: null,
        provider: null,
        fallback_provider: null,
        parent_agent_id: null,
        resource_uuid: null,
        sub_agents_count: 0,
        latest_run: null,
        created_at: '2026-08-18T00:00:00Z',
        ...overrides,
    };
}

function renderPage(agentsEnabled = true) {
    return render(
        <TeamContext.Provider value={{ teamId: 1, revision: 1, agentsEnabled }}>
            <AutomationPage />
        </TeamContext.Provider>,
    );
}

describe('AutomationPage', () => {
    beforeEach(() => {
        agents.mockReset();
        createAgent.mockReset();
        createAgentStandingOrder.mockReset();
        updateAgent.mockReset();
        agents.mockResolvedValue({ data: [] });
        createAgent.mockResolvedValue({ data: scheduledAgent() });
        createAgentStandingOrder.mockResolvedValue({ data: { id: 1 } });
    });

    afterEach(() => {
        cleanup();
    });

    it('explique que les agents sont requis', () => {
        renderPage(false);

        expect(screen.getByRole('heading', { name: 'Automations' })).toBeInTheDocument();
        expect(screen.getByText('Agents désactivés')).toBeInTheDocument();
    });

    it('propose la santé quotidienne quand aucune automation n’existe', async () => {
        renderPage(true);

        expect(await screen.findByRole('heading', { name: 'Créer la première automation' })).toBeInTheDocument();
        expect(screen.getByDisplayValue(DEFAULT_AUTOMATION_NAME)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Créer l’automation' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /tâches planifiées/i }).getAttribute('href')).toBe('/devforge/scheduled-tasks/');
    });

    it('liste les automations planifiées existantes', async () => {
        agents.mockResolvedValue({ data: [scheduledAgent()] });
        renderPage(true);

        expect(await screen.findByRole('heading', { name: DEFAULT_AUTOMATION_NAME })).toBeInTheDocument();
        expect(screen.getByText('Matin jours ouvrés — 9h')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Ouvrir' }).getAttribute('href')).toContain('/devforge/agents/agent-health/');
    });

    it('crée l’automation par défaut si elle est absente', async () => {
        renderPage(true);
        await screen.findByRole('button', { name: 'Créer l’automation' });
        screen.getByRole('button', { name: 'Créer l’automation' }).click();

        await waitFor(() => {
            expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
                name: DEFAULT_AUTOMATION_NAME,
                type: 'tech-watch',
                schedule_cron: '0 9 * * 1-5',
                heartbeat_enabled: true,
                is_active: true,
            }));
        });
    });
});
