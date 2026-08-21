import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { BotCharacter } from '../src/components/agents/BotCharacter';

afterEach(() => {
    cleanup();
});

describe('BotCharacter', () => {
    it('expose la forme et le nom pour l’accessibilité', () => {
        render(
            <BotCharacter
                name="Relanceur"
                color="#ef4444"
                shape="circle"
                size="lg"
                animate={false}
            />,
        );

        const avatar = screen.getByRole('img', { name: 'Avatar de Relanceur' });
        expect(avatar).toHaveAttribute('data-shape', 'circle');
        expect(avatar).toHaveAttribute('data-mood', 'idle');
    });

    it('passe en humeur working quand le bot s’exécute', () => {
        render(
            <BotCharacter
                name="CI"
                shape="triangle"
                type="github-actions"
                mood="working"
                animate={false}
            />,
        );

        expect(screen.getByRole('img', { name: 'Avatar de CI' })).toHaveAttribute('data-mood', 'working');
    });
});
