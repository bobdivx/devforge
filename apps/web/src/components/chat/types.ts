import type { ComponentChildren } from 'preact';
import type { AgentPlan, AgentReflection, AgentToolCall } from '../../lib/agent-stream';
import type { Milestone } from '../../lib/activity';
import type { NeedsUserAction } from '../../lib/publish-approval';
import type { LiveAction } from '../agents/AgentActionCards';

export type ChatMessage = {
  /** uuid serveur, ou `local-…` pour un message optimiste (clé React stable). */
  id: string;
  role: string;
  /** Erreur d'agent (réseau, 524…) : affichée en carte, jamais persistée. */
  error?: boolean;
  content: string;
  provider?: string;
  toolCalls?: AgentToolCall[];
  reflections?: AgentReflection[];
  plan?: AgentPlan | null;
  canOpenPr?: boolean;
  needsUserAction?: NeedsUserAction;
  /** Run en cours (brouillon streamé, P2-02) : le message final garde le même id. */
  streaming?: boolean;
  /** Accusé de réception immédiat (jamais persisté). */
  ack?: string;
  /** Étape courante (outil, jalon) affichée dans l'en-tête de la bulle. */
  liveLabel?: string;
  milestones?: Milestone[];
  /** Actions du run (live puis fusionnées avec le `Reply` par id). */
  actions?: LiveAction[];
  startedAt?: number;
  elapsedMs?: number;
};

/** Suggestion cliquable au-dessus du champ (envoie, préremplit ou action locale). */
export type ChatChip = {
  key: string;
  label: string;
  send?: string;
  prefill?: string;
  onClick?: () => void;
  tone?: 'default' | 'danger';
};

/**
 * Habillage « personnage » du fil principal (Braise) : pas de liste de fils,
 * pas de jargon, avatar + suggestions toujours visibles.
 */
export type ChatPersona = {
  name: string;
  title: string;
  tagline: string;
  /**
   * Ligne d'état facultative affichée à la place du sous-titre (ex. brouillon en cours).
   * Même hauteur que le sous-titre : son apparition ne décale pas le fil.
   */
  status?: ComponentChildren;
  avatar: ComponentChildren;
  smallAvatar: ComponentChildren;
  placeholder: string;
  emptyText: string;
  chips: ChatChip[];
};
