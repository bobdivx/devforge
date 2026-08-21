import { describe, expect, it } from 'vitest';
import { isOpenChoiceCard, parseChoiceCard } from '../src/lib/agent-choice-card';

describe('parseChoiceCard', () => {
    it('lit une carte GitHub à deux options', () => {
        const card = parseChoiceCard({
            choice_card: {
                id: 'github_connect',
                title: 'Connecte GitHub',
                body: 'Pour inspecter tes dépôts',
                options: [
                    { id: 'A', label: 'Connecter GitHub', prompt: 'Connecte GitHub' },
                    { id: 'B', label: 'Plus tard' },
                ],
            },
        });

        expect(card?.id).toBe('github_connect');
        expect(card?.options).toHaveLength(2);
        expect(card?.options[1]?.prompt).toBe('Plus tard');
        expect(isOpenChoiceCard({ choice_card: card })).toBe(true);
    });

    it('ignore une carte déjà choisie', () => {
        expect(isOpenChoiceCard({
            choice_card: {
                title: 'App',
                options: [
                    { id: 'A', label: 'Un' },
                    { id: 'B', label: 'Deux' },
                ],
                selected_id: 'A',
            },
        })).toBe(false);
    });
});
