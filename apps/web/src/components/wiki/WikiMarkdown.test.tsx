import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { splitTableRow, WikiMarkdown } from './WikiMarkdown';

const known = new Set(['Home', 'Kubernetes', 'Premier-demarrage']);

describe('WikiMarkdown (wiki public)', () => {
  it('HTML brut affiché en texte, jamais interprété', () => {
    (window as unknown as { __pwned?: number }).__pwned = undefined;
    const { container } = render(
      <WikiMarkdown
        known={known}
        text={'<script>window.__pwned=1</script>\n\n<img src=x onerror="window.__pwned=2">\n\n**<b>gras</b>**'}
      />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>window.__pwned=1</script>');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('liens dangereux rendus en texte, liens wiki et externes sûrs', () => {
    const { container } = render(
      <WikiMarkdown
        known={known}
        text={'[x](javascript:alert(1)) [y](data:text/html,a) [[Kubernetes]] [[Absente]] [gh](https://github.com/bobdivx/devforge)'}
      />,
    );
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/wiki/Kubernetes/', 'https://github.com/bobdivx/devforge']);
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.innerHTML).not.toContain('data:text');
    const ext = container.querySelector('a[href^="https://"]')!;
    expect(ext.getAttribute('rel')).toContain('noopener');
    expect(container.textContent).toContain('Absente');
  });

  it('titres avec ancres, listes imbriquées, code dans une liste, tableaux avec [[a|b]]', () => {
    const md = [
      '# Titre',
      '## Étape 1',
      '1. Créer le secret :',
      '',
      '   ```bash',
      '   kubectl get ns',
      '   ```',
      '',
      '2. Déclarer :',
      '   - sous-point',
      '',
      '| Tu veux | Page |',
      '|---|---|',
      '| Démarrer | [[Premier démarrage|Premier-demarrage]] |',
    ].join('\n');
    const { container } = render(<WikiMarkdown known={known} text={md} />);
    expect(container.querySelector('h1')!.textContent).toBe('Titre');
    expect(container.querySelector('h2')!.id).toBe('etape-1');
    const ol = container.querySelector('ol')!;
    expect(ol.querySelectorAll(':scope > li')).toHaveLength(2);
    expect(ol.querySelector('li ul li')!.textContent).toContain('sous-point');
    expect(ol.textContent).toContain('kubectl get ns');
    const cells = container.querySelectorAll('tbody td');
    expect(cells).toHaveLength(2);
    expect(cells[1].querySelector('a')!.getAttribute('href')).toBe('/wiki/Premier-demarrage/');
  });

  it('découpe de cellule : barre verticale protégée dans [[…]] et `code`', () => {
    expect(splitTableRow('| a | [[L|P]] | `x|y` |')).toEqual(['a', '[[L|P]]', '`x|y`']);
  });
});
