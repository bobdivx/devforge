import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentViewSwitcher } from '../src/components/agents/AgentViewSwitcher';

afterEach(() => {
    cleanup();
});

describe('AgentViewSwitcher', () => {
    it('affiche les deux modes avec leurs compteurs', () => {
        render(
            <AgentViewSwitcher
                mode="chat"
                sessionsCount={2}
                runsCount={14}
                onChange={() => {}}
            />,
        );

        expect(screen.getByRole('tab', { name: 'Conversation, 2' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Exécutions, 14' })).toHaveAttribute('aria-selected', 'false');
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('14')).toBeInTheDocument();
        expect(screen.getByText('Discuter avec l\'agent')).toBeInTheDocument();
        expect(screen.getByText('Webhook, manuel, planifié')).toBeInTheDocument();
    });

    it('bascule via le select mobile', () => {
        const onChange = vi.fn();

        render(
            <AgentViewSwitcher
                mode="chat"
                runsCount={14}
                onChange={onChange}
            />,
        );

        fireEvent.change(screen.getByRole('combobox', { name: 'Mode agent' }), { target: { value: 'runs' } });
        expect(onChange).toHaveBeenCalledWith('runs');
    });

    it('bascule vers les exécutions', () => {
        const onChange = vi.fn();

        render(
            <AgentViewSwitcher
                mode="chat"
                runsCount={14}
                onChange={onChange}
            />,
        );

        fireEvent.click(screen.getByRole('tab', { name: 'Exécutions, 14' }));
        expect(onChange).toHaveBeenCalledWith('runs');
    });
});
