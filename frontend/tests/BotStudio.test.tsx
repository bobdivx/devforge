import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotStudio } from '../src/components/agents/BotStudio';
import { BOT_STUDIO_TOOLS_KEY } from '../src/lib/bot-studio';

const createAgent = vi.fn();
const aiProviders = vi.fn();

vi.mock('../src/lib/domain-api', () => ({
    domainApi: {
        createAgent: (...args: unknown[]) => createAgent(...args),
        aiProviders: (...args: unknown[]) => aiProviders(...args),
    },
}));

afterEach(() => {
    cleanup();
    localStorage.removeItem(BOT_STUDIO_TOOLS_KEY);
});

describe('BotStudio', () => {
    beforeEach(() => {
        createAgent.mockReset();
        aiProviders.mockReset();
        aiProviders.mockResolvedValue({ data: [{ id: 1, name: 'Local', provider: 'ollama' }] });
        createAgent.mockResolvedValue({
            data: { uuid: 'bot-1', name: 'Relanceur de déploiements', type: 'deployment' },
        });
    });

    it('affiche les missions et ouvre les outils au clic', async () => {
        render(
            <BotStudio
                open
                variant="page"
                userName="Mathieu"
                onClose={() => {}}
                onCreated={() => {}}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Donnez une mission à chaque Bot' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Relanceur de déploiements/i }));
        expect(await screen.findByRole('heading', { name: /Qu.utilisez-vous au quotidien/i })).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Rechercher')).toBeInTheDocument();
    });

    it('crée un bot depuis une suggestion de personnage', async () => {
        localStorage.setItem(BOT_STUDIO_TOOLS_KEY, JSON.stringify(['github']));
        const onCreated = vi.fn();

        render(
            <BotStudio
                open
                variant="overlay"
                userName="Mathieu"
                onClose={() => {}}
                onCreated={onCreated}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /Santé des applications/i }));
        expect(await screen.findByRole('button', { name: 'Commencer' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Ingénieur QA/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Commencer' }));

        await waitFor(() => {
            expect(createAgent).toHaveBeenCalled();
        });

        const payload = createAgent.mock.calls[0]?.[0] as { name: string; type: string; avatar_shape: string };
        expect(payload.name).toBe('Ingénieur QA');
        expect(payload.type).toBe('debug');
        expect(payload.avatar_shape).toBe('cloud');
        expect(onCreated).toHaveBeenCalled();
    });
});
