import { h } from 'preact';
import { fireEvent, render, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { Markdown, MD_MESSAGE_CLASS } from './markdown';

const md = (text: string) => render(h(Markdown, { text, class: MD_MESSAGE_CLASS }));

describe('Markdown', () => {
  it('rend les titres en blocs gras', () => {
    const { container } = md('# Titre\n### Sous-titre');
    const ps = container.querySelectorAll('p');
    expect(ps[0].textContent).toBe('Titre');
    expect(ps[0].className).toContain('font-semibold');
    expect(ps[1].textContent).toBe('Sous-titre');
  });

  it('rend les listes à puces et numérotées', () => {
    const { container } = md('- un\n- deux\n\n1. premier\n2. second');
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('rend un tableau', () => {
    const { container } = md('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
    expect(container.querySelectorAll('thead th')).toHaveLength(2);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.querySelector('tbody td')?.textContent).toBe('1');
  });

  it('fence avec langue → CodeBlock reçoit la langue, code non replié', () => {
    const { container, getByRole } = md('```ts\nconst a = 1;\n```');
    const block = container.querySelector('.df-codeblock') as HTMLElement;
    expect(block).toBeTruthy();
    expect(block.dataset.lang).toBe('ts');
    expect(block.textContent).toContain('ts');
    const pre = container.querySelector('pre') as HTMLElement;
    expect(pre.className).toContain('whitespace-pre');
    expect(pre.className).not.toContain('whitespace-pre-wrap');
    expect(pre.className).toContain('overflow-auto');
    expect(pre.textContent).toBe('const a = 1;');
    expect(getByRole('button', { name: 'Copier le code' })).toBeTruthy();
  });

  it('fence sans langue → libellé « texte »', () => {
    const { container } = md('```\nbrut\n```');
    const block = container.querySelector('.df-codeblock') as HTMLElement;
    expect(block.dataset.lang).toBeUndefined();
    expect(block.textContent).toContain('texte');
  });

  it('refuse les liens javascript:', () => {
    const { container } = md('[clic](javascript:alert(1)) et [ok](https://example.com)');
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.com');
    expect(links[0].getAttribute('rel')).toContain('noopener');
    expect(container.textContent).toContain('[clic](javascript:alert(1))');
  });

  it("n'interprète jamais de HTML brut", () => {
    const { container } = md('<img src=x onerror=alert(1)> <b>gras</b>');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('CodeBlock — copier', () => {
  it('copie via navigator.clipboard puis affiche « Copié »', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { getByRole, findByText } = md('```sh\necho ok\n```');
    fireEvent.click(getByRole('button', { name: 'Copier le code' }));
    await findByText('Copié');
    expect(writeText).toHaveBeenCalledWith('echo ok');
  });

  it('repli execCommand quand le presse-papiers est indisponible (HTTP LAN)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    const { getByRole, findByText } = md('```\nabc\n```');
    fireEvent.click(getByRole('button', { name: 'Copier le code' }));
    await findByText('Copié');
    expect(exec).toHaveBeenCalledWith('copy');
    await waitFor(() => expect(document.querySelectorAll('textarea')).toHaveLength(0));
  });
});
