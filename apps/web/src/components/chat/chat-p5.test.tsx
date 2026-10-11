import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { AgentChatResult } from '../../lib/agent-stream';
import { targetSize } from '../../lib/image-compress';
import { Composer, imageFilesFrom } from './Composer';
import { ImageViewer } from './ImageViewer';
import { QuestionCard, questionFrom } from './QuestionCard';
import { ReactionPicker, ReactionPills } from './Reactions';
import { answerModelText, useAgentThread, type AgentThreadApi } from './useAgentThread';

const png = (name = 'capture.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

describe('P5-02 images', () => {
  it('coller une capture → fichiers image transmis, le texte collé reste normal', () => {
    const onAddFiles = vi.fn();
    const { container } = render(
      <Composer value="" onChange={() => undefined} onSubmit={() => undefined} busy={false} placeholder="Message" inputId="c" onAddFiles={onAddFiles} />,
    );
    const ta = container.querySelector('textarea')!;
    fireEvent.paste(ta, { clipboardData: { files: [png(), new File(['x'], 'a.txt', { type: 'text/plain' })], items: null } });
    expect(onAddFiles).toHaveBeenCalledTimes(1);
    expect(onAddFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(['capture.png']);
    fireEvent.paste(ta, { clipboardData: { files: [], items: null } });
    expect(onAddFiles).toHaveBeenCalledTimes(1);
  });

  it('vignettes 56 px avec ✕ ; envoi possible avec une image seule', () => {
    const onSubmit = vi.fn();
    const onRemove = vi.fn();
    const { container, getByLabelText } = render(
      <Composer
        value=""
        onChange={() => undefined}
        onSubmit={onSubmit}
        busy={false}
        placeholder="Message"
        inputId="c"
        onAddFiles={() => undefined}
        onRemoveAttachment={onRemove}
        attachments={[{ localId: 'l1', name: 'a.png', previewUrl: 'blob:x', status: 'ready' }]}
      />,
    );
    expect(container.querySelector('[data-composer-attachments] .h-14.w-14')).not.toBeNull();
    fireEvent.click(getByLabelText('Retirer l’image a.png'));
    expect(onRemove).toHaveBeenCalledWith('l1');
    const send = getByLabelText('Envoyer') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
  });

  it('envoi bloqué tant qu’une image est en cours d’envoi', () => {
    const { getByLabelText } = render(
      <Composer
        value="voici"
        onChange={() => undefined}
        onSubmit={() => undefined}
        busy={false}
        placeholder="Message"
        inputId="c"
        attachments={[{ localId: 'l1', name: 'a.png', previewUrl: 'blob:x', status: 'uploading' }]}
      />,
    );
    expect((getByLabelText('Envoyer') as HTMLButtonElement).disabled).toBe(true);
  });

  it('imageFilesFrom lit aussi les items du presse-papiers', () => {
    const f = png();
    const items = [{ kind: 'file', getAsFile: () => f }, { kind: 'string', getAsFile: () => null }] as unknown as DataTransferItemList;
    expect(imageFilesFrom({ files: [], items })).toEqual([f]);
  });

  it('redimensionnement au-delà de 2 000 px, ratio conservé', () => {
    expect(targetSize(1200, 800)).toBeNull();
    expect(targetSize(4000, 3000)).toEqual({ w: 2000, h: 1500 });
    expect(targetSize(1000, 5000)).toEqual({ w: 400, h: 2000 });
  });

  it('visionneuse : Échap ferme, flèches naviguent', () => {
    const onClose = vi.fn();
    const onIndex = vi.fn();
    const imgs = [0, 1].map((i) => ({ id: `${i}`.repeat(64), url: '', name: `i${i}.png`, mime: 'image/png', width: 10, height: 10 }));
    render(<ImageViewer images={imgs} index={0} onIndex={onIndex} onClose={onClose} />);
    expect(document.querySelector('[data-image-viewer]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onIndex).toHaveBeenCalledWith(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

const ask = [
  {
    name: 'ask_user',
    arguments: {},
    result: {
      ok: true,
      awaiting_answer: true,
      question: 'Je pousse le correctif lockfile sur fix/lockfile ?',
      options: [
        { id: 'yes', label: 'Oui, publier', action: 'approve_publish', style: 'primary' },
        { id: 'no', label: 'Non, garder en local' },
      ],
      allow_free_text: true,
    },
  },
] as never;

describe('P5-04 QuestionCard', () => {
  it('ouverte : un clic suffit, les autres options s’estompent puis se figent', () => {
    const q = questionFrom(ask)!;
    const onAnswer = vi.fn();
    const { getByText, container } = render(<QuestionCard q={q} state="open" onAnswer={onAnswer} />);
    fireEvent.click(getByText('Oui, publier'));
    expect(onAnswer).toHaveBeenCalledWith({ optionId: 'yes', label: 'Oui, publier', action: 'approve_publish' });
    const no = getByText('Non, garder en local').closest('button')!;
    expect(no.disabled).toBe(true);
    expect(no.className).toContain('opacity-40');
    fireEvent.click(no);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-question="done"]')).not.toBeNull();
  });

  it('répondue : lecture seule « Tu as choisi : X »', () => {
    const { getByText, queryByText } = render(<QuestionCard q={questionFrom(ask)!} state="answered" answer={{ label: 'Non, garder en local', optionId: 'no' }} />);
    expect(getByText('Non, garder en local').closest('[data-question-answer]')).not.toBeNull();
    expect(queryByText('Oui, publier')).toBeNull();
  });

  it('dépassée : boutons inactifs ; « Autre… » envoie une réponse libre', () => {
    const { getByText } = render(<QuestionCard q={questionFrom(ask)!} state="stale" />);
    expect((getByText('Oui, publier').closest('button') as HTMLButtonElement).disabled).toBe(true);
    const onAnswer = vi.fn();
    const r = render(<QuestionCard q={questionFrom(ask)!} state="open" onAnswer={onAnswer} />);
    fireEvent.click(r.getByText('Autre…'));
    fireEvent.input(r.getByLabelText('Ta réponse'), { target: { value: 'sur une autre branche' } });
    fireEvent.click(r.getByText('Envoyer'));
    expect(onAnswer).toHaveBeenCalledWith({ label: 'Autre', text: 'sur une autre branche' });
  });

  it('texte pour le modèle', () => {
    expect(answerModelText('On publie ?', 'Oui')).toBe('Réponse à ta question « On publie ? » : Oui');
    expect(answerModelText('On publie ?', 'Autre', 'demain')).toBe('Réponse à ta question « On publie ? » : Autre — demain');
  });
});

describe('P5-03 réactions', () => {
  it('pastilles : clic = bascule ; la mienne est marquée', () => {
    const onToggle = vi.fn();
    const { getByLabelText } = render(<ReactionPills reactions={[{ emoji: '👍', count: 2, mine: true }, { emoji: '🎉', count: 1, mine: false }]} onToggle={onToggle} />);
    const mine = getByLabelText('👍 2 — retirer ma réaction');
    expect(mine.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(getByLabelText('🎉 1 — réagir'));
    expect(onToggle).toHaveBeenCalledWith('🎉');
  });

  it('menu « Réagir » au clavier : flèches puis Échap', () => {
    const onClose = vi.fn();
    const onPick = vi.fn();
    const { getAllByRole, getByRole } = render(<ReactionPicker onPick={onPick} onClose={onClose} />);
    const items = getAllByRole('menuitem');
    expect(items).toHaveLength(6);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(getByRole('menu'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.click(items[1]);
    expect(onPick).toHaveBeenCalledWith('👎');
    fireEvent.keyDown(getByRole('menu'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

type Srv = { uuid: string; role: string; content: string; tool_calls_json?: string; reactions_json?: string };
function client(history: Srv[], over: Partial<AgentThreadApi> = {}) {
  return {
    agentMessages: vi.fn(async () => ({ data: history })) as never,
    activeRun: vi.fn(async () => ({ data: null })) as never,
    cancelAgentRun: vi.fn() as never,
    clearAgentMessages: vi.fn() as never,
    approvePublish: vi.fn(async () => ({ ok: true })) as never,
    projectAgents: vi.fn(async () => ({ data: [] })) as never,
    stream: vi.fn(async () => ({ reply: 'ok', tool_calls: [] }) as unknown as AgentChatResult) as never,
    subscribe: vi.fn() as never,
    ...over,
  } as AgentThreadApi;
}

describe('useAgentThread — P5', () => {
  it('réponse à une question : accord de publication puis message structuré', async () => {
    const c = client([{ uuid: 'q1', role: 'assistant', content: 'Je pousse ?', tool_calls_json: JSON.stringify(ask) }]);
    const { result } = renderHook(() => useAgentThread({ projectUuid: 'p', agentUuid: 'ag', client: c }));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await act(async () => result.current.onAnswer(result.current.messages[0], 'Je pousse ?', { optionId: 'yes', label: 'Oui, publier', action: 'approve_publish' }));
    await waitFor(() => expect(c.stream).toHaveBeenCalled());
    expect(c.approvePublish).toHaveBeenCalledWith('p');
    const [text, extra] = (c.stream as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(text).toBe('');
    expect(extra).toMatchObject({ answer: { message_uuid: 'q1', option_id: 'yes', label: 'Oui, publier', question: 'Je pousse ?' } });
    expect(result.current.messages[1].answer).toMatchObject({ answerTo: 'q1', label: 'Oui, publier' });
  });

  it('réaction optimiste puis corrigée par le serveur', async () => {
    const react = vi.fn(async () => ({ ok: true, reactions: [{ emoji: '👍', count: 2, mine: true }] }));
    const c = client([{ uuid: 'a1', role: 'assistant', content: 'Fait.' }], { reactToMessage: react as never });
    const { result } = renderHook(() => useAgentThread({ projectUuid: 'p', agentUuid: 'ag', client: c }));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await act(async () => result.current.onReact('a1', '👍'));
    expect(react).toHaveBeenCalledWith('a1', '👍', true);
    expect(result.current.messages[0].reactions).toEqual([{ emoji: '👍', count: 2, mine: true }]);
  });

  it('image jointe + réponse ciblée → ids envoyés avec le message', async () => {
    const upload = vi.fn(async () => ({ ok: true, data: { id: 'f'.repeat(64), url: '/x', name: 'capture.png', mime: 'image/png', width: 4, height: 3, size: 4 } }));
    const c = client([{ uuid: 'a1', role: 'assistant', content: 'Le build casse sur la page 2' }], { uploadAgentAttachment: upload as never });
    globalThis.URL.createObjectURL ??= () => 'blob:x';
    globalThis.URL.revokeObjectURL ??= () => undefined;
    const { result } = renderHook(() => useAgentThread({ projectUuid: 'p', agentUuid: 'ag', client: c }));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    act(() => result.current.onReply(result.current.messages[0]));
    expect(result.current.replyTo?.excerpt).toContain('Le build casse');
    await act(async () => result.current.attachments.addFiles([png()]));
    await waitFor(() => expect(result.current.attachments.items[0]?.status).toBe('ready'));
    await act(async () => result.current.send('regarde'));
    const [, extra] = (c.stream as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(extra).toMatchObject({ reply_to: 'a1', attachments: ['f'.repeat(64)] });
    expect(result.current.messages[1]).toMatchObject({ replyTo: 'a1', attachments: [{ name: 'capture.png' }] });
    expect(result.current.replyTo).toBeNull();
    expect(result.current.attachments.items).toHaveLength(0);
  });
});
