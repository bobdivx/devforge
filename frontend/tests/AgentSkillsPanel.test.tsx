import { render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSkillsPanel } from '../src/components/agents/AgentSkillsPanel';
import type { Agent } from '../src/lib/domain-api';

const agentSkills = vi.fn();
const createAgentSkill = vi.fn();
const deleteAgentSkill = vi.fn();

vi.mock('../src/lib/domain-api', () => ({
    domainApi: {
        agentSkills: (...args: unknown[]) => agentSkills(...args),
        createAgentSkill: (...args: unknown[]) => createAgentSkill(...args),
        deleteAgentSkill: (...args: unknown[]) => deleteAgentSkill(...args),
    },
}));

const agent = {
    uuid: 'agent-1',
    name: 'Ops',
    resource_uuid: 'app-1',
} as Agent;

describe('AgentSkillsPanel', () => {
    beforeEach(() => {
        agentSkills.mockReset();
        createAgentSkill.mockReset();
        deleteAgentSkill.mockReset();
        agentSkills.mockResolvedValue({
            data: [
                {
                    id: 1,
                    slug: 'fix-deploy-502',
                    name: 'Corriger HTTP 502',
                    description: 'Traefik ports',
                    body: '# steps',
                    tags: ['deploy'],
                    agent_id: null,
                    is_active: true,
                    is_builtin: true,
                    priority: 100,
                    created_at: null,
                    updated_at: null,
                },
            ],
        });
    });

    it('affiche le catalogue de skills', async () => {
        render(<AgentSkillsPanel agent={agent} />);

        await waitFor(() => {
            expect(screen.getByText(/fix-deploy-502/)).toBeTruthy();
        });
        expect(screen.getByText(/Corriger HTTP 502/)).toBeTruthy();
        expect(agentSkills).toHaveBeenCalledWith({ agent_uuid: 'agent-1' });
    });
});
