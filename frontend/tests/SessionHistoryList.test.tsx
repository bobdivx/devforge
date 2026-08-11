import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionHistoryList } from '../src/components/agents/SessionHistoryList';
import type { AgentChatSession } from '../src/lib/domain-api';

afterEach(() => {
    cleanup();
});

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

    it('n’affiche pas le bouton supprimer pour une session legacy', () => {
        render(
            <SessionHistoryList
                sessions={[session({ uuid: 'legacy-1', title: 'Historique', is_legacy: true })]}
                selectedUuid={null}
                onSelect={() => {}}
                onDelete={() => {}}
            />,
        );

        expect(screen.queryByRole('button', { name: /Supprimer/i })).toBeNull();
    });
});
