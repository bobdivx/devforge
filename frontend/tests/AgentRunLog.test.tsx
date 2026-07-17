import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRunLog } from '../src/components/agents/AgentRunLog';

afterEach(() => {
    cleanup();
});

describe('AgentRunLog', () => {
    it('applique les classes anti-débordement', () => {
        const longLine = '/nix/store/very-long-path-that-should-not-expand-the-card-width.json '.repeat(4);
        const { container } = render(<AgentRunLog logs={longLine} class="max-h-80" />);
        const pre = container.querySelector('pre');

        expect(pre).toHaveClass('min-w-0');
        expect(pre).toHaveClass('max-w-full');
        expect(pre).toHaveClass('whitespace-pre-wrap');
        expect(pre).toHaveClass('break-all');
        expect(pre).toHaveClass('overflow-x-auto');
    });
});
