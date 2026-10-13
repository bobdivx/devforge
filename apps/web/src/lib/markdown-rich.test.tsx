import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { Markdown } from './markdown';
import { sanitizeSvg } from './sanitize-svg';
import { KATEX_OPTIONS } from '../components/chat/MathBlock';

vi.mock('mermaid', () => ({
  default: {
    initialize: () => undefined,
    render: async (_id: string, code: string) => {
      if (code.includes('casse')) throw new Error('Parse error on line 1');
      return {
        svg: '<svg id="m"><style>.n{fill:#fff}</style><script>window.__pwned=1</script><g onclick="window.__pwned=2"><a href="javascript:alert(1)"><text>A</text></a><a href="#ok"><text>B</text></a></g><foreignObject><div><img src="x" onerror="window.__pwned=3"></div></foreignObject></svg>',
      };
    },
  },
}));

describe('Markdown riche (P5-01)', () => {
  it('fence mermaid → diagramme nettoyé, bouton « Voir le code »', async () => {
    const { container, getByText } = render(<Markdown text={'Voici :\n```mermaid\ngraph TD; A-->B\n```'} />);
    expect(container.querySelector('[data-mermaid="loading"]')).not.toBeNull();
    await waitFor(() => expect(container.querySelector('[data-mermaid="svg"]')).not.toBeNull(), { timeout: 3000 });
    const html = container.querySelector('[data-mermaid="svg"]')!.innerHTML;
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#ok"');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(getByText('Voir le code')).toBeTruthy();
  });

  it('mermaid invalide → bloc de code avec message', async () => {
    const { container } = render(<Markdown text={'```mermaid\ngraph casse\n```'} />);
    await waitFor(() => expect(container.textContent).toContain('Diagramme illisible'), { timeout: 3000 });
    expect(container.querySelector('.df-codeblock')).not.toBeNull();
  });

  it('maths inline et bloc ; les montants en dollars restent du texte', async () => {
    const { container } = render(<Markdown text={'Aire $\\pi r^2$ ici.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nPrix entre $5 et $10, variable $HOME/$USER.'} />);
    await waitFor(() => expect(container.querySelectorAll('.katex').length).toBe(2), { timeout: 5000 });
    expect(container.querySelector('[data-math="block"]')).not.toBeNull();
    expect(container.textContent).toContain('Prix entre $5 et $10, variable $HOME/$USER.');
  });

  it('KaTeX : pas de lien javascript ni de HTML injecté', async () => {
    const katex = (await import('katex')).default;
    const out = katex.renderToString('\\href{javascript:alert(1)}{x} <script>alert(1)</script> \\htmlId{a}{b}', { ...KATEX_OPTIONS });
    expect(out).not.toContain('href="javascript:');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('id="a"');
  });

  it('listes de tâches → cases non interactives', () => {
    const { container } = render(<Markdown text={'- [x] build\n- [ ] déployer\n- simple'} />);
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).disabled).toBe(true);
    expect(container.querySelector('[data-task="todo"]')?.textContent).toContain('déployer');
  });

  it('code coloré en jetons (pas d’innerHTML), même texte', async () => {
    const code = 'const a: number = 1;\n// fin';
    const { container } = render(<Markdown text={'```ts\n' + code + '\n```'} />);
    await waitFor(() => expect(container.querySelector('code[data-highlighted]')).not.toBeNull(), { timeout: 10000 });
    const el = container.querySelector('code')!;
    expect(el.textContent).toBe(code);
    expect(el.querySelectorAll('span[style]').length).toBeGreaterThan(3);
  });

  it('sanitizeSvg retire scripts et gestionnaires', () => {
    const out = sanitizeSvg('<svg><script>x</script><rect onload="x" style="fill:url(javascript:x)" /><image href="https://e.x/a.png"/></svg>');
    expect(out).not.toMatch(/script|onload|javascript|image/);
  });
});
