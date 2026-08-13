import { ChevronRight, Clock, MessageSquare, MessagesSquare, Trash2 } from 'lucide-preact';
import type { AgentChatSession } from '../../lib/domain-api';

function formatSessionDate(iso: string | null): string {
    if (!iso) {
        return 'Aucun message';
    }

    return new Date(iso).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function sessionPreview(session: AgentChatSession): string {
    if (session.last_message_at) {
        return `Dernier message · ${formatSessionDate(session.last_message_at)}`;
    }

    return `Créée · ${formatSessionDate(session.created_at)}`;
}

type Props = {
    sessions: AgentChatSession[];
    selectedUuid: string | null;
    onSelect: (uuid: string) => void;
    onDelete?: (uuid: string) => void;
    deletingUuid?: string | null;
};

export function SessionHistoryList({
    sessions,
    selectedUuid,
    onSelect,
    onDelete,
    deletingUuid = null,
}: Props) {
    if (sessions.length === 0) {
        return (
            <div class="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <div class="grid size-12 place-items-center rounded-2xl bg-base-200 text-base-content/40">
                    <MessagesSquare class="size-6" aria-hidden />
                </div>
                <div>
                    <p class="text-sm font-medium text-base-content/80">Aucune conversation</p>
                    <p class="mt-1 text-xs text-base-content/50">
                        Créez une session pour commencer à discuter avec l&apos;agent.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <ul class="space-y-2 p-2">
            {sessions.map((session) => {
                const selected = selectedUuid === session.uuid;
                const canDelete = Boolean(onDelete);
                const deleting = deletingUuid === session.uuid;

                return (
                    <li key={session.uuid} class="relative">
                        <button
                            class={`group flex w-full items-start gap-3 rounded-xl border px-3 py-3 pe-10 text-left transition-all ${
                                selected
                                    ? 'border-primary/40 bg-primary/10 shadow-sm ring-1 ring-primary/20'
                                    : 'border-base-300/80 bg-base-100 hover:border-base-content/20 hover:bg-base-200/50'
                            }`}
                            type="button"
                            onClick={() => onSelect(session.uuid)}
                        >
                            <div class="mt-0.5 shrink-0">
                                <span class="flex size-9 items-center justify-center rounded-lg bg-base-200 text-base-content/70 group-hover:bg-base-300/80">
                                    <MessageSquare class="size-4" aria-hidden />
                                </span>
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <p class="line-clamp-2 text-xs font-medium leading-snug text-base-content">
                                        {session.title}
                                    </p>
                                    {session.is_legacy && (
                                        <span class="badge badge-xs border-base-300 bg-base-200 text-base-content/60">
                                            Partagé
                                        </span>
                                    )}
                                </div>
                                <p class="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-base-content/50">
                                    <Clock class="size-3 shrink-0" aria-hidden />
                                    <span>{sessionPreview(session)}</span>
                                </p>
                            </div>
                            {!canDelete && (
                                <ChevronRight class={`mt-2 size-4 shrink-0 ${selected ? 'text-primary' : 'text-base-content/30'}`} aria-hidden />
                            )}
                        </button>
                        {canDelete && (
                            <button
                                type="button"
                                class="btn btn-ghost btn-xs absolute end-1.5 top-1.5 z-10 size-8 min-h-8 p-0 text-error hover:bg-error/15 hover:text-error"
                                title="Supprimer la conversation"
                                aria-label={`Supprimer ${session.title}`}
                                disabled={deleting}
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onDelete?.(session.uuid);
                                }}
                            >
                                {deleting
                                    ? <span class="loading loading-spinner loading-xs" aria-hidden />
                                    : <Trash2 class="size-3.5" aria-hidden />}
                            </button>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
