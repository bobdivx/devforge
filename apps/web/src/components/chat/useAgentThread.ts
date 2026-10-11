import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../../lib/api';
import { streamAgentChat, subscribeRun, type AgentChatResult, type StreamHandlers } from '../../lib/agent-stream';
import { isLocalId, localMessageId, messagesSignature, reconcileMessageIds } from '../../lib/chat-messages';
import { cancelQueued, EMPTY_QUEUE, enqueue, flushOnIdle, type ComposerQueue } from '../../lib/composer-queue';
import { markLaunchedStatus } from '../../lib/launched-agents';
import { approveThenSend, PUBLISH_APPROVAL_KIND } from '../../lib/publish-approval';
import { useToast } from '../ui';
import { adoptServerUuids, draftHandlers, draftMessage, finalizedMessage, fromServerMessages } from './messages';
import { useAttachments } from './useAttachments';
import { storeThread } from './thread-meta';
import type { Answer, ChatMessage } from './types';

export type AgentThreadApi = {
  agentMessages: typeof api.agentMessages;
  activeRun: typeof api.activeRun;
  cancelAgentRun: typeof api.cancelAgentRun;
  clearAgentMessages: typeof api.clearAgentMessages;
  approvePublish: typeof api.approvePublish;
  projectAgents: typeof api.projectAgents;
  stream: typeof streamAgentChat;
  subscribe: typeof subscribeRun;
  reactToMessage?: typeof api.reactToMessage;
  uploadAgentAttachment?: typeof api.uploadAgentAttachment;
};

/** Choix fait dans une carte de question (P5-04). */
export type QuestionChoice = { optionId?: string; label: string; text?: string; action?: string };
/** Message cité (P5-06). */
export type ReplyTarget = { id: string; serverUuid: string; excerpt: string };

export function answerModelText(question: string, label: string, text?: string): string {
  const q = question.trim();
  const free = (text ?? '').trim();
  const l = label.trim();
  const ans = free && l ? `${l} — ${free}` : free || l;
  return q ? `Réponse à ta question « ${q} » : ${ans}` : `Réponse : ${ans}`;
}

const defaultClient: AgentThreadApi = {
  agentMessages: (p, a) => api.agentMessages(p, a),
  activeRun: (p, a) => api.activeRun(p, a),
  cancelAgentRun: (r) => api.cancelAgentRun(r),
  clearAgentMessages: (p, a) => api.clearAgentMessages(p, a),
  approvePublish: (p) => api.approvePublish(p),
  projectAgents: (p) => api.projectAgents(p),
  stream: streamAgentChat,
  subscribe: subscribeRun,
  reactToMessage: (u, e, on) => api.reactToMessage(u, e, on),
  uploadAgentAttachment: (p, a, f, n) => api.uploadAgentAttachment(p, a, f, n),
};

export type AgentThreadOptions = {
  projectUuid: string;
  agentUuid: string | null;
  /** Mémoriser le fil choisi (pas en mode persona). */
  rememberThread?: boolean;
  /** Relever l'état du fil dès le montage (mode builder). */
  initialPoll?: boolean;
  /** Avant l'envoi (ex. nommer une tâche isolée à son premier message). */
  beforeSend?: (text: string, emptyThread: boolean) => Promise<void> | void;
  /** Message parti : la vue revient en bas. */
  onSent?: () => void;
  /** Réponse finale reçue. */
  onReplied?: (res: AgentChatResult) => void;
  /** Run suivi terminé (fini ou annulé). */
  onRunEnd?: (agentUuid: string) => void;
  client?: AgentThreadApi;
};

/** Fil d'un agent : historique, envoi streamé, file d'attente, reprise d'un run en cours, arrêt réel. */
export function useAgentThread({
  projectUuid,
  agentUuid: selected,
  rememberThread,
  initialPoll,
  beforeSend,
  onSent,
  onReplied,
  onRunEnd,
  client = defaultClient,
}: AgentThreadOptions) {
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [following, setFollowing] = useState(false);
  const [pollEnabled, setPollEnabled] = useState(!!initialPoll);
  /** Garde synchrone (le state `busy` capturé dans une closure peut être périmé). */
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /** Run suivi en direct (P4-02) : uuid pour l'arrêt réel (P4-05). */
  const runRef = useRef<string | null>(null);
  /** Abonnement à un run déjà en cours (onglet rouvert, réveil, autre appareil). */
  const followRef = useRef<{ run: string; ctrl: AbortController } | null>(null);
  /** Brouillon de la réponse en direct (libellé « Arrêt demandé… »). */
  const liveDraftRef = useRef<string | null>(null);
  /** Un seul message en file pendant un run (envoyé à la fin). */
  const [queue, setQueueState] = useState<ComposerQueue>(EMPTY_QUEUE);
  const queueRef = useRef<ComposerQueue>(EMPTY_QUEUE);
  const setQueue = (q: ComposerQueue) => {
    queueRef.current = q;
    setQueueState(q);
  };
  /** P5-02 : images du composer, envoyées dès l'ajout. */
  const upload = client.uploadAgentAttachment;
  const attachments = useAttachments(
    selected && upload ? (blob, name) => upload(projectUuid, selected, blob, name) : null,
    (msg) => toast.push({ title: 'Image non jointe', detail: msg, tone: 'danger' }),
  );
  /** P5-06 : réponse ciblée. */
  const [replyTo, setReplyToState] = useState<ReplyTarget | null>(null);
  const replyRef = useRef<ReplyTarget | null>(null);
  const setReplyTo = (r: ReplyTarget | null) => {
    replyRef.current = r;
    setReplyToState(r);
  };
  /** Ids de l'historique chargé au montage du fil : ceux-là ne sont pas animés. */
  const history = useRef<{ agent: string | null; ids: Set<string> }>({ agent: null, ids: new Set() });

  const updateMessage = (id: string) => (fn: (m: ChatMessage) => ChatMessage) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  const handlersFor = (draftId: string): StreamHandlers =>
    draftHandlers(updateMessage(draftId), (runUuid) => {
      runRef.current = runUuid;
    });
  const finalize = (draftId: string, res: AgentChatResult, startedAt: number) =>
    updateMessage(draftId)((m) => finalizedMessage(m, res, startedAt));

  async function loadMessages(agentUuid: string, opts: { adoptOnly?: boolean } = {}) {
    try {
      const r = await client.agentMessages(projectUuid, agentUuid);
      const next = fromServerMessages(r.data ?? []);
      if (opts.adoptOnly) {
        // Après un tour envoyé ici : uuids serveur seulement, l'affichage ne bouge pas.
        setMessages((prev) => adoptServerUuids(prev, next));
        return;
      }
      // Premier chargement de ce fil : c'est l'historique, pas d'animation en cascade.
      if (history.current.agent !== agentUuid) history.current = { agent: agentUuid, ids: new Set(next.map((m) => m.id)) };
      setMessages((prev) => {
        // Un run en direct a démarré entre-temps : ne pas écraser son brouillon.
        if (prev.some((m) => m.streaming)) return adoptServerUuids(prev, next);
        const reconciled = reconcileMessageIds(prev, next);
        // Même contenu ⇒ mêmes messages affichés ; seuls les uuids serveur sont adoptés.
        return messagesSignature(reconciled) === messagesSignature(prev) && prev.length > 0 ? adoptServerUuids(prev, next) : reconciled;
      });
    } catch {
      if (!opts.adoptOnly) setMessages([]);
    }
  }

  /** Fin de run : envoie le message en attente (s'il y en a un). */
  function flushQueue() {
    const { state, send } = flushOnIdle(queueRef.current);
    setQueue(state);
    if (send) window.setTimeout(() => void sendRef.current(send), 0);
  }

  /** Reprend le flux d'un run déjà en cours sur ce fil (P4-02). */
  async function attachActiveRun(agentUuid: string) {
    if (busyRef.current || followRef.current) return;
    let run: Awaited<ReturnType<typeof api.activeRun>>['data'] = null;
    try {
      run = (await client.activeRun(projectUuid, agentUuid)).data;
    } catch {
      return;
    }
    if (!run || busyRef.current || followRef.current) return;
    const ctrl = new AbortController();
    followRef.current = { run: run.run_uuid, ctrl };
    setFollowing(true);
    const startedAt = Date.parse(run.started_at) || Date.now();
    const draft = draftMessage(startedAt);
    liveDraftRef.current = draft.id;
    setMessages((m) => [...m, draft]);
    try {
      const res = await client.subscribe(run.run_uuid, handlersFor(draft.id), ctrl.signal);
      finalize(draft.id, res, startedAt);
    } catch {
      if (ctrl.signal.aborted) return;
      setMessages((prev) => prev.filter((m) => m.id !== draft.id));
    } finally {
      if (followRef.current?.ctrl === ctrl) followRef.current = null;
      if (liveDraftRef.current === draft.id) liveDraftRef.current = null;
      setFollowing(!!followRef.current);
      setStopping(false);
      if (!ctrl.signal.aborted) {
        markLaunchedStatus(agentUuid, 'idle');
        onRunEnd?.(agentUuid);
        // Message persisté (et éventuelles cartes) : le fil se recale sur le serveur.
        void loadMessages(agentUuid);
        flushQueue();
      }
    }
  }

  // P4-02 : plus de polling 1 s des messages. Les runs se suivent par flux reprenable ;
  // un relevé lent (15 s) du statut des fils détecte un run démarré ailleurs (réveil, worker).
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    let lastStatus: string | undefined;
    const check = async () => {
      if (busyRef.current || followRef.current) return;
      try {
        const agentsRes = await client.projectAgents(projectUuid);
        if (!alive) return;
        const status = agentsRes.data.find((a) => a.uuid === selected)?.status;
        if (status === 'working') await attachActiveRun(selected);
        else if (lastStatus === 'working') await loadMessages(selected);
        lastStatus = status;
      } catch (err) {
        console.error('[ProjectAgentsPanel] statut des fils :', err);
      }
    };
    if (pollEnabled) {
      setPollEnabled(false);
      void check();
    }
    const interval = setInterval(check, 15_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [pollEnabled, selected, projectUuid]);

  useEffect(() => {
    if (selected) {
      if (rememberThread) storeThread(projectUuid, selected);
      // Run en cours sur ce fil (onglet fermé puis rouvert…) : on reprend son flux.
      void loadMessages(selected).then(() => attachActiveRun(selected));
    } else setMessages([]);
    return () => {
      followRef.current?.ctrl.abort();
      followRef.current = null;
    };
  }, [selected, projectUuid]);

  // Effacement déclenché ailleurs (Réglages avancés de la page simple).
  useEffect(() => {
    const onCleared = (ev: Event) => {
      const id = (ev as CustomEvent<{ agentUuid?: string }>).detail?.agentUuid;
      if (id && id === selected) setMessages([]);
    };
    window.addEventListener('devforge:chat-cleared', onCleared);
    return () => window.removeEventListener('devforge:chat-cleared', onCleared);
  }, [selected]);

  /** Stop : arrêt réel du run côté serveur (P4-05) ; le flux reçoit « Arrêté à ta demande… ». */
  function stop() {
    const run = runRef.current ?? followRef.current?.run ?? null;
    if (!run) {
      abortRef.current?.abort();
      return;
    }
    setStopping(true);
    const draft = liveDraftRef.current;
    if (draft) updateMessage(draft)((m) => ({ ...m, ack: undefined, liveLabel: 'Arrêt demandé…' }));
    client.cancelAgentRun(run).catch((e: unknown) => {
      setStopping(false);
      toast.push({ title: 'Arrêt impossible', detail: String((e as Error)?.message || e), tone: 'danger' });
    });
  }

  async function send(text: string, opts: { answer?: { messageUuid?: string; question: string; choice: QuestionChoice } } = {}) {
    const trimmed = text.trim();
    const withImages = attachments.peekReady();
    if ((!trimmed && !withImages && !opts.answer) || !selected) return;
    if (attachments.isUploading()) {
      toast.push({ title: 'Image en cours d’envoi', detail: 'Réessaie dans un instant, dès qu’elle est prête.', tone: 'info' });
      return;
    }
    if (busyRef.current || followRef.current) {
      if (opts.answer || !trimmed) return;
      // Run en cours (ici ou repris) : la saisie reste libre, l'envoi part à la fin.
      setQueue(enqueue(queueRef.current, trimmed));
      setInput('');
      return;
    }
    busyRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    let aborted = false;
    let replied = false;
    setBusy(true);
    markLaunchedStatus(selected, 'working');
    // Brouillon de réponse créé tout de suite : points de frappe, puis texte streamé (même id à la fin).
    const startedAt = Date.now();
    const draft = draftMessage(startedAt);
    runRef.current = null;
    liveDraftRef.current = draft.id;
    const emptyThread = messages.length === 0;
    const images = attachments.take();
    const reply = replyRef.current;
    setReplyTo(null);
    const a = opts.answer;
    const answer: Answer | undefined = a
      ? { answerTo: a.messageUuid ?? null, optionId: a.choice.optionId ?? null, label: a.choice.label, text: a.choice.text ?? null }
      : undefined;
    const userMsg: ChatMessage = {
      id: localMessageId(),
      role: 'user',
      content: a ? answerModelText(a.question, a.choice.label, a.choice.text) : trimmed,
      attachments: images.length ? images : undefined,
      replyTo: reply?.serverUuid,
      answer,
    };
    setMessages((m) => [...m, userMsg, draft]);
    setInput('');
    onSent?.();
    await beforeSend?.(trimmed, emptyThread);
    try {
      const res = await client.stream(
        trimmed,
        {
          project_uuid: projectUuid,
          agent_uuid: selected,
          ...(a
            ? { answer: { message_uuid: a.messageUuid, option_id: a.choice.optionId, label: a.choice.label, question: a.question, text: a.choice.text } }
            : {}),
          ...(reply ? { reply_to: reply.serverUuid } : {}),
          ...(images.length ? { attachments: images.map((i) => i.id) } : {}),
        },
        handlersFor(draft.id),
        controller.signal,
      );
      finalize(draft.id, res, startedAt);
      replied = true;
      onReplied?.(res);
      if ((res.tool_calls ?? []).some((t) => t.name === 'start_local_preview' && t.result?.public_ok === false)) setPollEnabled(true);
    } catch (err: unknown) {
      if (controller.signal.aborted || (err as Error)?.name === 'AbortError') {
        // Stop sans run persistant (repli) : seul l'affichage s'arrête ; le run continue côté serveur,
        // le fil relève son état pour récupérer la réponse.
        aborted = true;
        setMessages((prev) => prev.filter((m) => m.id !== draft.id));
        setPollEnabled(true);
      } else {
        const msg = String((err as Error).message || err);
        // La carte d'erreur (avec « Réessayer ») remplace le brouillon, au même endroit.
        setMessages((prev) => prev.map((m) => (m.id === draft.id ? { id: draft.id, role: 'assistant', content: msg, error: true } : m)));
      }
    } finally {
      busyRef.current = false;
      abortRef.current = null;
      runRef.current = null;
      liveDraftRef.current = null;
      setStopping(false);
      setBusy(false);
      markLaunchedStatus(selected, aborted ? 'working' : 'idle');
      if (aborted) {
        // Le serveur travaille encore : on ne relance pas de run par-dessus. Le message en attente revient dans la saisie.
        const pending = queueRef.current.queued;
        setQueue(EMPTY_QUEUE);
        if (pending) setInput((cur) => (cur.trim() ? `${pending}\n\n${cur}` : pending));
      } else {
        // Uuids serveur du tour (réactions, citations) sans re-rendu du message affiché.
        if (replied) void loadMessages(selected, { adoptOnly: true });
        flushQueue();
      }
    }
  }

  /** P5-04 : réponse à une question `ask_user` (accord de publication d'abord si l'option le demande). */
  async function answerQuestion(m: ChatMessage, question: string, choice: QuestionChoice) {
    if (choice.action === 'approve_publish') {
      try {
        await client.approvePublish(projectUuid);
      } catch (e: unknown) {
        toast.push({ title: 'Validation impossible', detail: String((e as Error)?.message || e), tone: 'danger' });
        return;
      }
    }
    await send('', { answer: { messageUuid: m.serverUuid ?? (isLocalId(m.id) ? undefined : m.id), question, choice } });
  }

  /** P5-03 : ajoute / retire une réaction (optimiste, corrigé par la réponse du serveur). */
  async function react(id: string, emoji: string) {
    const target = messagesRef.current.find((x) => x.id === id);
    const uuid = target?.serverUuid;
    if (!target || !uuid || !client.reactToMessage) return;
    const before = target.reactions;
    const mine = !!before?.find((r) => r.emoji === emoji)?.mine;
    const toggled = (before ?? [])
      .map((r) => (r.emoji === emoji ? { ...r, count: r.count + (mine ? -1 : 1), mine: !mine } : r))
      .filter((r) => r.count > 0);
    const optimistic = before?.some((r) => r.emoji === emoji) ? toggled : [...toggled, { emoji, count: 1, mine: true }];
    setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, reactions: optimistic } : x)));
    try {
      const r = await client.reactToMessage(uuid, emoji, !mine);
      setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, reactions: r.reactions } : x)));
    } catch (e: unknown) {
      setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, reactions: before } : x)));
      toast.push({ title: 'Réaction non enregistrée', detail: String((e as Error)?.message || e), tone: 'danger' });
    }
  }

  /** P5-06 : « Répondre » sur une bulle. */
  function startReply(m: ChatMessage) {
    if (!m.serverUuid) return;
    const excerpt = m.content.replace(/\s+/g, ' ').trim().slice(0, 140);
    setReplyTo({ id: m.id, serverUuid: m.serverUuid, excerpt: excerpt || (m.attachments?.length ? 'Image' : '…') });
  }

  /** « Réessayer » sur une carte d'erreur : renvoie le dernier message utilisateur. */
  function retry(errorId: string) {
    if (busyRef.current) return;
    const idx = messages.findIndex((m) => m.id === errorId);
    if (idx < 0) return;
    let userIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userIdx = i;
        break;
      }
    }
    const text = userIdx >= 0 ? messages[userIdx].content : null;
    // Le message utilisateur optimiste sera ré-ajouté par send (pas de doublon).
    const dropUser = userIdx >= 0 && isLocalId(messages[userIdx].id);
    const dropIds = new Set([errorId, ...(dropUser ? [messages[userIdx].id] : [])]);
    setMessages((prev) => prev.filter((m) => !dropIds.has(m.id)));
    if (text) void send(text);
  }

  async function approvePublish(text: string) {
    try {
      await approveThenSend(
        () => client.approvePublish(projectUuid),
        (t) => {
          // Accord posé : les anciennes cartes « Validation requise » n'ont plus lieu d'être.
          setMessages((prev) => prev.map((m) => (m.needsUserAction?.kind === PUBLISH_APPROVAL_KIND ? { ...m, needsUserAction: undefined } : m)));
          void sendRef.current(t);
        },
        text,
      );
    } catch (e: unknown) {
      toast.push({ title: 'Validation impossible', detail: String((e as Error)?.message || e), tone: 'danger' });
    }
  }

  async function clear() {
    if (!selected) return;
    await client.clearAgentMessages(projectUuid, selected);
    setMessages([]);
  }

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Callbacks stables pour les messages mémoïsés (toujours la dernière version).
  const answerRef = useRef(answerQuestion);
  answerRef.current = answerQuestion;
  const reactRef = useRef(react);
  reactRef.current = react;
  const replyStartRef = useRef(startReply);
  replyStartRef.current = startReply;
  const onAnswer = useCallback((m: ChatMessage, q: string, c: QuestionChoice) => void answerRef.current(m, q, c), []);
  const onReact = useCallback((id: string, emoji: string) => void reactRef.current(id, emoji), []);
  const onReply = useCallback((m: ChatMessage) => replyStartRef.current(m), []);
  const sendRef = useRef(send);
  sendRef.current = send;
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const approveRef = useRef(approvePublish);
  approveRef.current = approvePublish;
  const loadRef = useRef(loadMessages);
  loadRef.current = loadMessages;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onSend = useCallback((t: string) => void sendRef.current(t), []);
  const onRetry = useCallback((id: string) => retryRef.current(id), []);
  const onApprovePublish = useCallback((t: string) => void approveRef.current(t), []);
  /** Fin d'une carte de job : la carte de résultat arrive dans le fil (posée par le serveur). */
  const onJobFinished = useCallback(() => {
    const id = selectedRef.current;
    if (!id) return;
    for (const delay of [1200, 4000]) {
      window.setTimeout(() => {
        if (selectedRef.current === id && !busyRef.current) void loadRef.current(id);
      }, delay);
    }
  }, []);

  return {
    messages,
    setMessages,
    historyIds: history.current.ids,
    input,
    setInput,
    busy,
    following,
    stopping,
    queued: queue.queued,
    cancelQueued: () => setQueue(cancelQueued(queueRef.current)),
    send,
    stop,
    clear,
    loadMessages,
    requestStatusCheck: () => setPollEnabled(true),
    onSend,
    onRetry,
    onApprovePublish,
    onJobFinished,
    onAnswer,
    onReact,
    onReply,
    attachments,
    replyTo,
    cancelReply: () => setReplyTo(null),
  };
}
