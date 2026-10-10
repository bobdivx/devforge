import { act, fireEvent, render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { AgentActionList, AgentThinkingBlock } from '../agents/AgentActionCards';
import { JumpToLatest } from './JumpToLatest';
import { MessageEnter } from './MessageEnter';

describe('MessageEnter', () => {
  it('n’anime que les nouveaux messages', () => {
    const { container, rerender } = render(
      <MessageEnter role="user" animate={false}>
        a
      </MessageEnter>,
    );
    expect((container.firstChild as HTMLElement).dataset.messageEnter).toBe('static');
    rerender(
      <MessageEnter role="assistant" animate>
        b
      </MessageEnter>,
    );
    // Le preset est figé au premier rendu : pas de ré-animation au polling.
    expect((container.firstChild as HTMLElement).dataset.messageEnter).toBe('animated');
  });
  it('bulle utilisateur : origine bas-droite', () => {
    const { container } = render(
      <MessageEnter role="user" animate>
        a
      </MessageEnter>,
    );
    expect((container.firstChild as HTMLElement).className).toContain('origin-bottom-right');
  });
});

describe('JumpToLatest', () => {
  it('invisible par défaut, clic → callback', () => {
    const onClick = vi.fn();
    const { queryByRole, rerender } = render(<JumpToLatest visible={false} onClick={onClick} />);
    expect(queryByRole('button')).toBeNull();
    rerender(<JumpToLatest visible onClick={onClick} />);
    fireEvent.click(queryByRole('button', { name: /Nouveaux messages/ }) as HTMLElement);
    expect(onClick).toHaveBeenCalled();
  });
});

describe('AgentThinkingBlock', () => {
  it('trois points + libellé ; compteur seulement après 3 s', () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      const { container, queryByText, getByText } = render(
        <AgentThinkingBlock label="lecture du fichier" startedAt={start} />,
      );
      expect(container.querySelectorAll('.df-dot')).toHaveLength(3);
      expect(getByText('lecture du fichier').className).toContain('df-fade-in');
      expect(queryByText(/Réflexion ·/)).toBeNull();
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(queryByText(/Réflexion · 4 s/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AgentActionList — clés stables', () => {
  it('une carte ouverte reste ouverte quand la liste change', () => {
    const a = { call_id: 'c1', name: 'run_workdir_command', arguments: { command: 'ls' }, result: { ok: true, output: 'fichier.txt' }, status: 'ok' as const };
    const b = { call_id: 'c0', name: 'get_project', arguments: {}, result: { ok: true, message: 'projet' }, status: 'ok' as const };
    const { getByText, queryByText, rerender } = render(<AgentActionList actions={[b]} />);
    // get_project est fermé par défaut → on l'ouvre.
    expect(queryByText('projet')).toBeNull();
    fireEvent.click(getByText('get project'));
    expect(getByText('projet')).toBeTruthy();
    // Insertion avant : avec une clé index, l'état ouvert passerait à la mauvaise carte.
    rerender(<AgentActionList actions={[a, b]} />);
    expect(getByText('projet')).toBeTruthy();
  });
});
