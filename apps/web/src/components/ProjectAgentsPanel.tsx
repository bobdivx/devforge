import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { useKeyboardOverlap } from '../lib/useVisualViewport';
import { ChatHeader, LlmAlert } from './chat/ChatHeader';
import { ChatThread, useStickToBottom } from './chat/ChatThread';
import { Composer } from './chat/Composer';
import { MessageItem } from './chat/MessageItem';
import { MobileThreadBar } from './chat/MobileThreadBar';
import { PersonaChips, PersonaEmptyState } from './chat/PersonaEmptyState';
import { metaFor, THREAD_STARTERS, threadLabel } from './chat/thread-meta';
import { TeamSidebar, ThreadSidebar } from './chat/ThreadSidebar';
import type { ChatChip, ChatPersona } from './chat/types';
import { useAgentThread } from './chat/useAgentThread';
import { useLlmStatus } from './chat/useLlmStatus';
import { useThreadList } from './chat/useThreadList';
import { Card, FadeIn, useToast } from './ui';

export type { ChatChip, ChatPersona } from './chat/types';

type Props = {
  projectUuid: string;
  /** Fil principal présenté comme un personnage (page projet simple). */
  persona?: ChatPersona;
  defaultAgentUuid?: string;
  builderMode?: boolean;
  /** `threads` = workspace style Cursor ; `team` = liste Ops/Deploy/Reviewer */
  mode?: 'threads' | 'team';
  /** Remplit la colonne chat du workspace (preview et fichiers à côté). */
  embedded?: boolean;
};

/** Chat agents projet — mode équipe ou fils de conversation (assembleur des briques `chat/`). */
export function ProjectAgentsPanel({ projectUuid, defaultAgentUuid, builderMode, mode = 'team', embedded = false, persona }: Props) {
  const threadsMode = mode === 'threads' || !!persona;
  const inputId = useId();
  const toast = useToast();
  const [sharing, setSharing] = useState(false);
  /** Grille du chat : sert à mesurer la part cachée par le clavier (iOS). */
  const gridRef = useRef<HTMLDivElement>(null);
  const statusCheckRef = useRef<() => void>(() => undefined);
  const llm = useLlmStatus([projectUuid, threadsMode]);
  const list = useThreadList({
    projectUuid,
    threadsMode,
    persona: !!persona,
    defaultAgentUuid,
    builderMode,
    onWorkingPicked: () => statusCheckRef.current(),
  });
  const { selected, current } = list;
  const stickRef = useRef<() => void>(() => undefined);
  const thread = useAgentThread({
    projectUuid,
    agentUuid: selected,
    rememberThread: !persona,
    initialPoll: builderMode,
    onSent: () => stickRef.current(),
    beforeSend: async (text, emptyThread) => {
      if (threadsMode && emptyThread && selected && (current?.name === 'Nouveau chat' || current?.name === 'Tâche isolée')) {
        await list.nameFromFirstMessage(selected, text);
      }
    },
    onReplied: () => {
      void llm.refresh();
      if (selected) list.touch(selected);
    },
    onRunEnd: list.markIdle,
  });
  statusCheckRef.current = thread.requestStatusCheck;
  const { messages, busy, following } = thread;
  const stick = useStickToBottom(messages, selected);
  stickRef.current = stick.follow;
  // Clavier mobile (iOS) : remonter le composer juste au-dessus, garder la dernière bulle visible.
  const kbOverlap = useKeyboardOverlap(gridRef, stick.keepBottom);

  useEffect(() => {
    list.bootstrapped.current = false;
    void list.loadAgents(defaultAgentUuid || null);
  }, [projectUuid, threadsMode]);

  async function createThread() {
    if (await list.createThread()) thread.setMessages([]);
  }

  async function shareChat() {
    if (!selected || sharing) return;
    setSharing(true);
    try {
      const r = await api.shareAgentConversation(projectUuid, selected);
      await navigator.clipboard.writeText(r.url.startsWith('http') ? r.url : `${window.location.origin}${r.path || r.url}`);
      toast.push({ title: 'Lien de partage copié', tone: 'ok' });
    } catch (e) {
      toast.push({ title: 'Partage impossible', detail: e instanceof Error ? e.message : String(e), tone: 'danger' });
    } finally {
      setSharing(false);
    }
  }

  const openThreadRef = useRef<(id: string) => void>(() => undefined);
  openThreadRef.current = (workerUuid) => void list.loadAgents(workerUuid).then(() => list.setSelected(workerUuid));
  const [onOpenThread] = useState(() => (id: string) => openThreadRef.current(id));

  function onChip(chip: ChatChip) {
    if (chip.onClick) return chip.onClick();
    if (chip.send) return void thread.send(chip.send);
    if (chip.prefill === undefined) return;
    thread.setInput(chip.prefill);
    window.setTimeout(() => {
      const el = document.getElementById(inputId) as HTMLTextAreaElement | null;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 0);
  }

  const currentMeta = current ? metaFor(current) : null;
  const title = threadsMode ? (current ? threadLabel(current) : 'Chat') : currentMeta?.label || 'Agent';
  const isCoordinator = current?.role === 'coordinator';
  const isSubagent = current?.kind === 'subagent';
  const blurb = isCoordinator
    ? 'Fil permanent du projet — contexte accumulé, workers éphémères'
    : isSubagent
      ? 'Sous-agent — tâche déléguée par le Coordinateur'
      : threadsMode
        ? 'Assistant projet — planifie, édite en local, preview'
        : currentMeta?.blurb;
  const select = (uuid: string) => list.setSelected(uuid);
  const sidebar = threadsMode ? (
    <ThreadSidebar rows={list.rows} selected={selected} onSelect={select} error={list.error} creating={list.creating} busy={busy} onCreate={() => void createThread()} />
  ) : (
    <TeamSidebar rows={list.rows} selected={selected} onSelect={select} error={list.error} loading={list.agents.length === 0} />
  );

  return (
    <FadeIn class={embedded ? 'flex h-full min-h-0 flex-col' : undefined}>
      {threadsMode && !persona && (
        <MobileThreadBar rows={list.rows} selected={selected} onSelect={select} creating={list.creating} busy={busy} onCreate={() => void createThread()} embedded={embedded} />
      )}
      <div
        ref={gridRef}
        style={{ '--kb': `${kbOverlap}px` }}
        class={cn('grid min-h-0 gap-4', embedded ? 'h-full flex-1 grid-cols-1' : threadsMode ? 'lg:grid-cols-[200px_1fr]' : 'lg:grid-cols-[240px_1fr]')}
      >
        <div class={cn(embedded ? 'hidden' : threadsMode && 'hidden lg:block')}>{sidebar}</div>
        <Card
          padding="none"
          class={cn(
            'flex min-h-0 flex-col overflow-hidden',
            // Clavier iOS : la part du panneau cachée sous le clavier devient du padding (0 sur desktop et Android).
            'max-lg:pb-[var(--kb,0px)]',
            persona && 'df-tap',
            embedded
              ? 'h-full'
              : threadsMode
                ? 'h-[min(calc(100dvh-12rem),720px)] lg:h-[min(calc(100dvh-10rem),800px)]'
                : 'h-[min(calc(100dvh-14rem),600px)] lg:h-[min(64vh,600px)]',
          )}
        >
          <ChatHeader
            persona={persona}
            title={title}
            blurb={blurb}
            isCoordinator={isCoordinator}
            isSubagent={isSubagent}
            working={current?.status === 'working' && !busy && !following}
            llmReady={llm.ready}
            llmMode={llm.mode}
            canShare={!!selected && messages.length > 0}
            sharing={sharing}
            onShare={() => void shareChat()}
            onClear={persona ? undefined : () => void thread.clear()}
            canClear={!!selected && !busy && messages.length > 0}
          />
          {!llm.ready && <LlmAlert error={llm.error} />}
          <ChatThread messages={messages} historyIds={thread.historyIds} stick={stick}>
            {messages.length === 0 && (
              <PersonaEmptyState
                persona={persona}
                threadsMode={threadsMode}
                starters={threadsMode ? THREAD_STARTERS : currentMeta?.starters ?? []}
                disabled={busy || !selected}
                onStarter={(s) => void thread.send(s)}
              />
            )}
            {messages.map((m) => (
              <MessageItem
                key={m.id}
                m={m}
                persona={persona}
                busy={busy}
                animate={!thread.historyIds.has(m.id)}
                onSend={thread.onSend}
                onRetry={thread.onRetry}
                onApprovePublish={thread.onApprovePublish}
                onOpenThread={persona ? undefined : onOpenThread}
                onJobFinished={thread.onJobFinished}
              />
            ))}
          </ChatThread>
          {persona && persona.chips.length > 0 && <PersonaChips chips={persona.chips} busy={busy} hasThread={!!selected} onChip={onChip} />}
          <Composer
            inputId={inputId}
            value={thread.input}
            onChange={thread.setInput}
            onSubmit={(text) => void thread.send(text)}
            busy={busy || following}
            disabled={!selected || thread.stopping}
            onStop={thread.stop}
            queued={thread.queued}
            onCancelQueued={thread.cancelQueued}
            placeholder={persona ? persona.placeholder : threadsMode ? 'Message…' : current ? `Message pour ${title}…` : 'Message…'}
            class={cn(
              'shrink-0 p-3',
              // Au focus (clavier mobile), garder la saisie au-dessus du dock bas.
              persona && 'scroll-mb-[calc(5rem+env(safe-area-inset-bottom,0px))]',
              !(persona && persona.chips.length > 0) && 'border-t border-[var(--color-line)]',
            )}
          />
        </Card>
      </div>
    </FadeIn>
  );
}
