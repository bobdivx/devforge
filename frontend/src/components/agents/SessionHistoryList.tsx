import { Puzzle, Search, Trash2 } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import type { Agent, AgentChatSession } from '../../lib/domain-api';
import { BotCharacter } from './BotCharacter';
import { botMoodFromStatus } from '../../lib/bot-character';

function formatSessionDate(iso: string | null): string {
    if (!iso) {
        return '';
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
        return formatSessionDate(session.last_message_at);
    }

    return formatSessionDate(session.created_at);
}

type Props = {
    agent: Agent;
    sessions: AgentChatSession[];
    selectedUuid: string | null;
    onSelect: (uuid: string) => void;
    onDelete?: (uuid: string) => void;
    deletingUuid?: string | null;
    userName?: string;
    onOpenPlugins?: () => void;
};

export function SessionHistoryList({
    agent,
    sessions,
    selectedUuid,
    onSelect,
    onDelete,
    deletingUuid = null,
    userName = 'Vous',
    onOpenPlugins,
}: Props) {
    const [query, setQuery] = useState('');
    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (needle === '') {
            return sessions;
        }

        return sessions.filter((session) => session.title.toLowerCase().includes(needle));
    }, [query, sessions]);

    return (
        <div class="flex h-full min-h-0 flex-1 flex-col">
            <div class="shrink-0 p-3">
                <label class="flex items-center gap-2 rounded-full border border-base-300 bg-base-200/70 px-3 py-2">
                    <Search class="size-3.5 shrink-0 text-base-content/40" aria-hidden />
                    <input
                        class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-base-content/40"
                        type="search"
                        placeholder="Rechercher"
                        value={query}
                        onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
                    />
                </label>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto">
                {filtered.length === 0 ? (
                    <div class="px-6 py-8 text-center">
                        <p class="text-sm font-medium text-base-content/80">Aucune conversation</p>
                        <p class="mt-1 text-xs text-base-content/50">
                            {query.trim() !== ''
                                ? 'Aucun résultat pour cette recherche.'
                                : 'Créez une session pour commencer à discuter.'}
                        </p>
                    </div>
                ) : (
                    <ul class="px-2 pb-2">
                        {filtered.map((session) => {
                            const selected = selectedUuid === session.uuid;
                            const deleting = deletingUuid === session.uuid;

                            return (
                                <li key={session.uuid} class="relative">
                                    <button
                                        class={`flex w-full items-start gap-3 rounded-xl px-2 py-2.5 pe-10 text-left transition ${
                                            selected ? 'bg-base-300/70' : 'hover:bg-base-200/70'
                                        }`}
                                        type="button"
                                        onClick={() => onSelect(session.uuid)}
                                    >
                                        <BotCharacter
                                            name={agent.name}
                                            color={agent.avatar_color}
                                            shape={agent.avatar_shape}
                                            type={agent.type}
                                            size="sm"
                                            mood={botMoodFromStatus(agent.status)}
                                            decorative
                                        />
                                        <div class="min-w-0 flex-1">
                                            <p class="truncate text-sm font-medium">{session.title}</p>
                                            <p class="mt-0.5 truncate text-[11px] text-base-content/50">
                                                {session.is_legacy ? 'Partagé · ' : ''}
                                                {sessionPreview(session)}
                                            </p>
                                        </div>
                                    </button>
                                    {onDelete && (
                                        <button
                                            type="button"
                                            class="btn btn-ghost btn-xs absolute end-1 top-1.5 z-10 size-8 min-h-8 p-0 text-error hover:bg-error/15 hover:text-error"
                                            title="Supprimer la conversation"
                                            aria-label={`Supprimer ${session.title}`}
                                            disabled={deleting}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                onDelete(session.uuid);
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
                )}
            </div>

            <div class="shrink-0 border-t border-base-300 p-2">
                {onOpenPlugins && (
                    <button
                        type="button"
                        class="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm hover:bg-base-200/70"
                        onClick={onOpenPlugins}
                    >
                        <span class="grid size-8 place-items-center rounded-lg bg-base-300 text-base-content/70">
                            <Puzzle class="size-4" aria-hidden />
                        </span>
                        Plugins
                    </button>
                )}
                <div class="flex items-center gap-3 px-2 py-2">
                    <span class="grid size-8 place-items-center rounded-full bg-teal-500 text-xs font-bold text-neutral">
                        {userName.trim().slice(0, 1).toUpperCase() || 'V'}
                    </span>
                    <span class="truncate text-sm font-medium">{userName}</span>
                </div>
            </div>
        </div>
    );
}
