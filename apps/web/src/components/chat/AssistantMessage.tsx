import { visibleActions } from '../../lib/activity';
import { jobsFromToolCalls, type Job } from '../../lib/jobs';
import { Markdown, MD_MESSAGE_CLASS } from '../../lib/markdown';
import { OPEN_PR_MESSAGE } from '../../lib/publish-approval';
import { cn } from '../../lib/cn';
import { AgentPlanActions, toLiveActions } from '../agents/AgentActionCards';
import { ActivityGroup } from './ActivityGroup';
import { JobCard, JobCardView } from './JobCard';
import { MilestoneBar } from './MilestoneBar';
import { RunBubble } from './RunBubble';
import { UserActionCard } from './UserActionCard';
import type { ChatMessage, ChatPersona } from './types';

export type AssistantMessageProps = {
  m: ChatMessage;
  persona?: ChatPersona;
  busy: boolean;
  /** Partage en lecture seule : ni boutons, ni cartes interactives. */
  readOnly?: boolean;
  onSend?: (text: string) => void;
  onApprovePublish?: (text: string) => void;
  onOpenThread?: (workerUuid: string) => void;
  onJobFinished?: (job: Job) => void;
};

const noop = () => undefined;

/** Réponse d'agent : jalons, activité, texte (streamé ou Markdown), cartes de job, plan, action requise. */
export function AssistantMessage({ m, persona, busy, readOnly, onSend = noop, onApprovePublish = noop, onOpenThread, onJobFinished }: AssistantMessageProps) {
  // P4-04 : délégation, résultat de worker, déploiement → cartes de job dans le message.
  const jobs = jobsFromToolCalls(m.toolCalls?.length ? m.toolCalls : (m.actions ?? []));
  return (
    <div class={cn(persona && 'flex items-start gap-2.5')}>
      {persona && <div class="pt-0.5">{persona.smallAvatar}</div>}
      <div class={cn('space-y-2', persona && 'min-w-0 flex-1')}>
        {m.milestones && m.milestones.length > 0 && <MilestoneBar items={m.milestones} />}
        <ActivityGroup
          actions={visibleActions(m.actions ?? toLiveActions(m.toolCalls ?? []))}
          reflections={m.reflections ?? []}
          live={!!m.streaming}
          elapsedMs={m.elapsedMs}
        />
        {m.streaming || m.elapsedMs !== undefined ? (
          <RunBubble
            content={m.content}
            streaming={!!m.streaming}
            ack={m.ack}
            label={m.liveLabel}
            startedAt={m.startedAt}
            elapsedMs={m.elapsedMs}
          />
        ) : m.content.trim() ? (
          <div class="max-w-full">
            <Markdown text={m.content} class={MD_MESSAGE_CLASS} />
            {m.provider && !persona && m.provider !== 'system' && (
              <div class="mt-1 text-[11px] text-[var(--color-ink-faint)]">{m.provider}</div>
            )}
          </div>
        ) : null}
        {jobs.map((job) => (
          readOnly ? (
            <JobCardView key={job.runUuid} job={job} nowMs={Date.now()} />
          ) : (
            <JobCard key={job.runUuid} initial={job} onOpenThread={onOpenThread} onFinished={onJobFinished} />
          )
        ))}
        {!readOnly && m.plan && m.plan.steps.length > 0 && (
          <AgentPlanActions
            plan={m.plan}
            canOpenPr={m.canOpenPr}
            busy={busy}
            onApprovePlan={m.canOpenPr ? undefined : () => onSend('Go — exécute ce plan en local, puis lance la preview.')}
            onOpenPr={() => onApprovePublish(OPEN_PR_MESSAGE)}
          />
        )}
        {!readOnly && m.needsUserAction && (
          <UserActionCard action={m.needsUserAction} busy={busy} onSend={onSend} onApprovePublish={onApprovePublish} />
        )}
      </div>
    </div>
  );
}
