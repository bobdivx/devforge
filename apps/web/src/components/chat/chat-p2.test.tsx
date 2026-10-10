import { act, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveAction } from '../../lib/activity';
import { ActivityGroup, LIVE_VISIBLE } from './ActivityGroup';
import { MilestoneBar } from './MilestoneBar';
import { RunBubble } from './RunBubble';
import { framesToReveal, revealStep, StreamingText } from './StreamingText';

afterEach(() => vi.useRealTimers());

function actions(n: number, running = false): LiveAction[] {
  return Array.from({ length: n }, (_, i) => ({
    call_id: `c${i}`,
    name: i % 3 === 0 ? 'write_project_file' : 'read_project_file',
    arguments: { path: `src/f${i}.ts`, content: 'x' },
    result: { ok: true, unified_diff: `--- a/src/f${i}.ts\n+++ b/src/f${i}.ts\n+ligne ${i}` },
    status: running && i === n - 1 ? 'running' : 'ok',
    seq: i,
  }));
}

describe('StreamingText', () => {
  it('révélation : 2 à 60 caractères par frame', () => {
    expect(revealStep(1)).toBe(2);
    expect(revealStep(80)).toBe(10);
    expect(revealStep(10_000)).toBe(60);
    expect(framesToReveal(2_000)).toBeLessThan(60);
  });

  it('révèle tout le texte en ≤ N frames (faux minuteurs)', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'Date'] });
    const text = 'Contraste du menu corrigé en local. '.repeat(20);
    const { container } = render(<StreamingText text={text} streaming />);
    expect(container.textContent?.length ?? 0).toBeLessThan(text.length);
    act(() => {
      vi.advanceTimersByTime(16 * (framesToReveal(text.length) + 2) + 100);
    });
    expect(container.textContent?.replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim());
    expect(container.querySelector('.df-caret')).not.toBeNull();
  });

  it('fin du streaming : texte complet, plus de curseur', () => {
    const { container, rerender } = render(<StreamingText text="Bonjour" streaming />);
    rerender(<StreamingText text="Bonjour tout le monde" streaming={false} />);
    expect(container.textContent).toContain('Bonjour tout le monde');
    expect(container.querySelector('.df-caret')).toBeNull();
  });
});

describe('RunBubble', () => {
  it('points de frappe tant qu’aucun texte, puis le texte (une seule zone vivante)', () => {
    const { getByTestId, queryByTestId, rerender, container } = render(
      <RunBubble content="" streaming ack="Je regarde." startedAt={Date.now()} />,
    );
    expect(getByTestId('typing')).toBeTruthy();
    expect(container.textContent).toContain('Je regarde.');
    rerender(<RunBubble content="Voici" streaming label="Lecture de src/app.ts" startedAt={Date.now()} />);
    expect(queryByTestId('typing')).toBeNull();
    expect(container.textContent).toContain('Lecture de src/app.ts');
    expect(container.querySelectorAll('[data-testid="run-bubble"]')).toHaveLength(1);
    rerender(<RunBubble content="Voici la réponse." streaming={false} elapsedMs={34_000} />);
    expect(container.textContent).toContain('Terminé · 34 s');
  });
});

describe('MilestoneBar', () => {
  it('affiche les étapes et leur état', () => {
    const { getByTestId } = render(
      <MilestoneBar
        items={[
          { label: 'Modification des fichiers', status: 'done' },
          { label: 'Build', status: 'failed' },
          { label: 'Preview locale', status: 'running' },
        ]}
      />,
    );
    const bar = getByTestId('milestone-bar');
    expect(bar.querySelectorAll('li')).toHaveLength(3);
    expect(bar.querySelector('[data-status="failed"]')?.textContent).toContain('Build');
    expect(bar.querySelector('[aria-label="terminé"]')).not.toBeNull();
    expect(bar.querySelector('[aria-label="en cours"]')).not.toBeNull();
  });
});

describe('ActivityGroup', () => {
  it('pendant le run : la courante + 2 précédentes, le reste dans « +N actions »', () => {
    const { container, getByText } = render(<ActivityGroup actions={actions(8, true)} live />);
    const pills = container.querySelectorAll('[data-status]');
    expect(pills).toHaveLength(LIVE_VISIBLE);
    expect(getByText('+5 actions')).toBeTruthy();
    fireEvent.click(getByText('+5 actions'));
    expect(container.querySelectorAll('[data-status]')).toHaveLength(8);
  });

  it('après le run : une ligne résumé repliée + diffs à un clic', () => {
    const { getByTestId, container, getByTitle } = render(
      <ActivityGroup actions={actions(10)} live={false} elapsedMs={34_000} />,
    );
    const summary = getByTestId('activity-summary');
    expect(summary.textContent).toContain('10 actions · 4 fichiers modifiés · 34 s');
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    // Résumé + au plus 3 fichiers : une seule rangée de boutons.
    expect(container.querySelectorAll('button').length).toBeLessThanOrEqual(4);
    const file = getByTitle('Voir le diff de src/f0.ts');
    fireEvent.click(file);
    expect(file.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('ligne 0');
  });

  it('clavier : pastilles focusables (boutons), aria-expanded sur le résumé', () => {
    const { getByTestId, container } = render(<ActivityGroup actions={actions(4)} live={false} />);
    fireEvent.click(getByTestId('activity-summary'));
    const pills = Array.from(container.querySelectorAll('button[data-status]')) as HTMLButtonElement[];
    expect(pills).toHaveLength(4);
    pills[1].focus();
    expect(document.activeElement).toBe(pills[1]);
    fireEvent.click(pills[1]);
    expect(pills[1].getAttribute('aria-expanded')).toBe('true');
  });

  it('continuité : même instance live → final (état ouvert conservé)', () => {
    const acts = actions(3);
    const { getByTitle, rerender, container } = render(<ActivityGroup actions={acts} live />);
    const pill = container.querySelector('button[data-status]') as HTMLButtonElement;
    fireEvent.click(pill);
    rerender(<ActivityGroup actions={acts} live={false} />);
    expect(container.querySelector('.df-collapse')?.getAttribute('data-open')).toBe('true');
    expect(getByTitle('Voir le diff de src/f0.ts')).toBeTruthy();
  });

  it('rien à afficher : aucun nœud', () => {
    const { container } = render(<ActivityGroup actions={[]} live={false} />);
    expect(container.innerHTML).toBe('');
  });
});
