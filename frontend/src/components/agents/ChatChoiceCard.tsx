import { Check, X } from 'lucide-preact';
import type { ChatChoiceCard } from '../../lib/agent-choice-card';

type Props = {
    card: ChatChoiceCard;
    disabled?: boolean;
    onSelect: (optionId: string, prompt: string) => void;
    onDismiss?: () => void;
};

export function ChatChoiceCardView({ card, disabled = false, onSelect, onDismiss }: Props) {
    const selected = card.selected_id;

    return (
        <section class="relative overflow-hidden rounded-2xl border border-base-300/80 bg-base-200/80 text-start shadow-sm">
            {onDismiss && !selected && (
                <button
                    type="button"
                    class="btn btn-ghost btn-xs btn-square absolute end-2 top-2 size-7 min-h-7 p-0 text-base-content/45"
                    aria-label="Fermer"
                    onClick={onDismiss}
                >
                    <X class="size-3.5" aria-hidden />
                </button>
            )}
            <div class="grid gap-2 px-3 sm:px-4 pb-3 pt-4 pe-10">
                <h2 class="text-xs sm:text-sm font-semibold leading-snug">{card.title}</h2>
                {card.body !== '' && (
                    <p class="text-xs leading-relaxed text-base-content/60">{card.body}</p>
                )}
            </div>
            <ul class="grid gap-px border-t border-base-300/70 bg-base-300/40">
                {card.options.map((option, index) => {
                    const isSelected = selected === option.id;
                    const letter = option.id.length === 1 ? option.id : String.fromCharCode(65 + index);

                    return (
                        <li key={option.id}>
                            <button
                                type="button"
                                disabled={disabled || Boolean(selected)}
                                aria-pressed={isSelected}
                                class={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${
                                    isSelected
                                        ? 'bg-success/10'
                                        : selected
                                            ? 'bg-base-100/40 text-base-content/45'
                                            : 'bg-base-100/70 hover:bg-base-100'
                                }`}
                                onClick={() => onSelect(option.id, option.prompt)}
                            >
                                <span class="mt-0.5 grid size-5 sm:size-6 shrink-0 place-items-center rounded-md border border-base-300 bg-base-200 text-[11px] font-semibold">
                                    {isSelected ? <Check class="size-3.5 text-success" aria-hidden /> : letter}
                                </span>
                                <span class="min-w-0 flex-1">
                                    <span class="block text-xs sm:text-sm font-medium">{option.label}</span>
                                    {option.hint && (
                                        <span class="mt-0.5 block text-[11px] text-base-content/50">{option.hint}</span>
                                    )}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
