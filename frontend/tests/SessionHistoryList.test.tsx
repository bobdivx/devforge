import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionHistoryList } from '../src/components/agents/SessionHistoryList';
import type { Agent, AgentChatSession } from '../src/lib/domain-api';

afterEach(() => {
    cleanup();
});

const agent = {
    uuid: 'agent-1',
    name: 'Ingénieur QA',
    type: 'debug',
    avatar_color: '#22c55e',
    avatar_shape: 'circle',
    status: 'idle',
} as Agent;

function session(overrides: Partial<AgentChatSession> = {}): AgentChatSession {
    return {
        uuid: 'sess-1',
        title: 'Ma conversation',
        is_legacy: false,
        chat_mode: 'build',
        created_at: '2026-08-11T10:00:00.000Z',
        last_message_at: '2026-08-11T11:00:00.000Z',
        ...overrides,
    };
}

describe('SessionHistoryList', () => {
    it('appelle onDelete sans sélectionner la session', () => {
        const onSelect = vi.fn();
        const onDelete = vi.fn();

        render(
            <SessionHistoryList
                agent={agent}
                sessions={[session()]}
                selectedUuid={null}
                onSelect={onSelect}
                onDelete={onDelete}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Supprimer Ma conversation' }));

        expect(onDelete).toHaveBeenCalledWith('sess-1');
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('affiche le bouton supprimer pour une session partagée (App · …)', () => {
        const onDelete = vi.fn();

        render(
            <SessionHistoryList
                agent={agent}
                sessions={[session({ uuid: 'legacy-1', title: 'App · starbasefr', is_legacy: true })]}
                selectedUuid={null}
                onSelect={() => {}}
                onDelete={onDelete}
                userName="Mathieu"
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Supprimer App · starbasefr' }));
        expect(onDelete).toHaveBeenCalledWith('legacy-1');
        expect(screen.getByText(/Partagé/)).toBeTruthy();
        expect(screen.getByText('Mathieu')).toBeTruthy();
    });
});
