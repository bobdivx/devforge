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

    it('filtre le catalogue par préfixe (typeahead)', () => {
        const onSelect = vi.fn();

        render(
            <ChatChoiceCardView
                card={{
                    id: 'pick_app',
                    title: 'Sur quelle app je commence ?',
                    body: 'Les apps en mauvais état d’abord.',
                    searchable: true,
                    options: [
                        { id: 'A', label: 'macompta', hint: 'running:unhealthy', prompt: 'inspecte macompta' },
                        { id: 'B', label: 'TeslaReports', hint: 'running:healthy', prompt: 'inspecte TeslaReports' },
                    ],
                    catalog: [
                        { id: 'app-0', label: 'macompta', hint: 'running:unhealthy', prompt: 'inspecte macompta' },
                        { id: 'app-1', label: 'TeslaReports', hint: 'running:healthy', prompt: 'inspecte TeslaReports' },
                        { id: 'app-2', label: 'aline-farm', prompt: 'inspecte aline-farm' },
                    ],
                }}
                onSelect={onSelect}
            />,
        );

        expect(screen.getByRole('button', { name: /macompta/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /TeslaReports/ })).toBeInTheDocument();

        fireEvent.input(screen.getByRole('searchbox', { name: 'Filtrer les applications' }), {
            target: { value: 'mac' },
        });

        expect(screen.getByRole('button', { name: /macompta/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /TeslaReports/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /aline-farm/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /macompta/ }));
        expect(onSelect).toHaveBeenCalledWith('app-0', 'inspecte macompta');
    });
});
