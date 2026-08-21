import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPermissionCard } from '../src/components/agents/ChatPermissionCard';

afterEach(() => {
    cleanup();
});

describe('ChatPermissionCard', () => {
    it('distingue toujours / une fois / jamais', () => {
        const onApprove = vi.fn();
        const onDeny = vi.fn();

        render(
            <ChatPermissionCard
                agentName="Ingénieur QA"
                pending={{ tool: 'exec_command', reason: 'SSH sur le serveur', status: 'ask' }}
                onApprove={onApprove}
                onDeny={onDeny}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Toujours autoriser' }));
        expect(onApprove).toHaveBeenCalledWith(true);

        fireEvent.click(screen.getByRole('button', { name: 'Autoriser une fois' }));
        expect(onApprove).toHaveBeenCalledWith(false);

        fireEvent.click(screen.getByRole('button', { name: 'Jamais' }));
        expect(onDeny).toHaveBeenCalled();
    });
});
