import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { autoResize, Composer, COMPOSER_MAX_HEIGHT, shouldSubmitOnEnter } from './Composer';

describe('shouldSubmitOnEnter', () => {
  it('Entrée envoie sur desktop', () => {
    expect(shouldSubmitOnEnter({ key: 'Enter', coarse: false })).toBe(true);
  });
  it('Maj+Entrée = saut de ligne', () => {
    expect(shouldSubmitOnEnter({ key: 'Enter', shiftKey: true, coarse: false })).toBe(false);
  });
  it('composition IME : jamais', () => {
    expect(shouldSubmitOnEnter({ key: 'Enter', isComposing: true, coarse: false })).toBe(false);
    expect(shouldSubmitOnEnter({ key: 'Enter', keyCode: 229, coarse: false })).toBe(false);
  });
  it('au doigt, Entrée = saut de ligne', () => {
    expect(shouldSubmitOnEnter({ key: 'Enter', coarse: true })).toBe(false);
  });
  it('autres touches', () => {
    expect(shouldSubmitOnEnter({ key: 'a', coarse: false })).toBe(false);
  });
});

describe('autoResize', () => {
  it('plafonne à 160 px puis scroll interne', () => {
    const el = document.createElement('textarea');
    Object.defineProperty(el, 'scrollHeight', { value: 400, configurable: true });
    autoResize(el);
    expect(el.style.height).toBe(`${COMPOSER_MAX_HEIGHT}px`);
    expect(el.style.overflowY).toBe('auto');
    Object.defineProperty(el, 'scrollHeight', { value: 60, configurable: true });
    autoResize(el);
    expect(el.style.height).toBe('60px');
    expect(el.style.overflowY).toBe('hidden');
  });
});

describe('<Composer>', () => {
  const base = {
    onChange: () => undefined,
    placeholder: 'Message…',
    inputId: 'cmp',
  };

  it('reste éditable pendant un run et affiche Stop', () => {
    const onStop = vi.fn();
    const { getByPlaceholderText, getByRole } = render(
      <Composer {...base} value="" onSubmit={() => undefined} busy onStop={onStop} />,
    );
    expect((getByPlaceholderText('Message…') as HTMLTextAreaElement).disabled).toBe(false);
    fireEvent.click(getByRole('button', { name: /Arrêter/ }));
    expect(onStop).toHaveBeenCalled();
  });

  it('Entrée pendant un run soumet (le parent met en file)', () => {
    const onSubmit = vi.fn();
    const { getByPlaceholderText } = render(
      <Composer {...base} value="suite" onSubmit={onSubmit} busy onStop={() => undefined} />,
    );
    fireEvent.keyDown(getByPlaceholderText('Message…'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('suite');
  });

  it('Maj+Entrée ne soumet pas', () => {
    const onSubmit = vi.fn();
    const { getByPlaceholderText } = render(<Composer {...base} value="x" onSubmit={onSubmit} busy={false} />);
    fireEvent.keyDown(getByPlaceholderText('Message…'), { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('garde le focus après envoi', () => {
    const { getByPlaceholderText, getByRole } = render(
      <Composer {...base} value="hello" onSubmit={() => undefined} busy={false} />,
    );
    const ta = getByPlaceholderText('Message…');
    ta.focus();
    fireEvent.click(getByRole('button', { name: 'Envoyer' }));
    expect(document.activeElement).toBe(ta);
  });

  it('affiche le message en attente avec ✕', () => {
    const onCancel = vi.fn();
    const { getByText, getByRole } = render(
      <Composer {...base} value="" onSubmit={() => undefined} busy queued="plus tard" onCancelQueued={onCancel} />,
    );
    expect(getByText('plus tard')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Annuler le message en attente' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('désactivé seulement sans fil sélectionné', () => {
    const { getByPlaceholderText } = render(
      <Composer {...base} value="" onSubmit={() => undefined} busy={false} disabled />,
    );
    expect((getByPlaceholderText('Message…') as HTMLTextAreaElement).disabled).toBe(true);
  });
});
