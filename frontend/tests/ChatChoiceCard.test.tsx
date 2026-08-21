import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatChoiceCardView } from '../src/components/agents/ChatChoiceCard';

afterEach(() => {
    cleanup();
});

describe('ChatChoiceCardView', () => {
    it('envoie le prompt de l’option cliquée', () => {
        const onSelect = vi.fn();

        render(
            <ChatChoiceCardView
                card={{
                    id: 'github_connect',
                    title: 'Connecte GitHub pour que je puisse inspecter tes dépôts',
                    body: 'Une GitHub App installée.',
                    options: [
                        { id: 'A', label: 'Connecter GitHub', prompt: 'Connecte GitHub' },
                        { id: 'B', label: 'Plus tard', prompt: 'Plus tard' },
                    ],
                }}
                onSelect={onSelect}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /Connecter GitHub/ }));

        expect(onSelect).toHaveBeenCalledWith('A', 'Connecte GitHub');
    });
});
