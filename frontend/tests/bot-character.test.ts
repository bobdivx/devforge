import { describe, expect, it } from 'vitest';
import {
    BOT_SHAPES,
    botHasTuft,
    botMoodFromStatus,
    isBotShape,
    resolveBotColor,
    resolveBotShape,
} from '../src/lib/bot-character';

describe('bot-character', () => {
    it('accepte uniquement les formes du catalogue', () => {
        expect(isBotShape('circle')).toBe(true);
        expect(isBotShape('robot')).toBe(false);
        expect(BOT_SHAPES).toContain('teardrop');
    });

    it('déduit la forme depuis le type d’agent', () => {
        expect(resolveBotShape(null, 'debug')).toBe('squircle');
        expect(resolveBotShape('cloud', 'debug')).toBe('cloud');
        expect(resolveBotShape('nope', 'security')).toBe('teardrop');
    });

    it('valide la couleur ou retombe sur le bleu', () => {
        expect(resolveBotColor('#ef4444')).toBe('#ef4444');
        expect(resolveBotColor('red')).toBe('#3b82f6');
        expect(resolveBotColor(null)).toBe('#3b82f6');
    });

    it('mappe le statut vers une humeur', () => {
        expect(botMoodFromStatus('running')).toBe('working');
        expect(botMoodFromStatus('paused')).toBe('sleep');
        expect(botMoodFromStatus('error')).toBe('sad');
        expect(botMoodFromStatus('idle')).toBe('idle');
    });

    it('donne une mèche de façon déterministe', () => {
        expect(botHasTuft('Relanceur')).toBe(botHasTuft('Relanceur'));
        expect(typeof botHasTuft('A')).toBe('boolean');
    });
});
