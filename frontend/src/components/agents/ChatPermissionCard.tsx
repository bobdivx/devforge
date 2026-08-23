import { ChevronDown, ShieldAlert } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { PendingToolApproval } from '../../lib/agent-pending-approval';

type Props = {
    agentName: string;
    pending: PendingToolApproval;
    disabled?: boolean;
    resolving?: boolean;
    onApprove: (remember: boolean) => void;
    onDeny: () => void;
};

export function ChatPermissionCard({
    agentName,
    pending,
    disabled = false,
    resolving = false,
    onApprove,
    onDeny,
}: Props) {
    const [showCommand, setShowCommand] = useState(false);
    const command = pending.diff_preview?.diff
        ?? (pending.reason.includes(' ') ? pending.reason : null);

    return (
        <section class="overflow-hidden rounded-2xl border border-warning/35 bg-warning/10 text-start">
            <div class="flex items-start gap-2 sm:gap-3 px-2.5 sm:px-3 md:px-3 sm:px-4 py-2.5 sm:py-3">
                <ShieldAlert class="mt-0.5 size-3.5 sm:size-4 shrink-0 text-warning" aria-hidden />
                <div class="min-w-0 flex-1">
                    <p class="text-xs sm:text-sm font-semibold leading-snug">
                        Autoriser {agentName} à exécuter « {pending.tool} » ?
                    </p>
                    {pending.reason && (
                        <p class="mt-1 text-xs leading-relaxed text-base-content/65">{pending.reason}</p>
                    )}
                    {pending.diff_preview && (
                        <button
                            type="button"
                            class="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-base-content/70"
                            onClick={() => setShowCommand((value) => !value)}
                        >
                            <ChevronDown class={`size-3 transition ${showCommand ? 'rotate-180' : ''}`} aria-hidden />
                            {showCommand ? 'Masquer la commande' : 'Afficher la commande'}
                        </button>
                    )}
                    {showCommand && pending.diff_preview && (
                        <pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-base-300/50 p-2 font-mono text-[10px] leading-relaxed">
                            {pending.diff_preview.path}
                            {'\n'}
                            {pending.diff_preview.diff}
                        </pre>
                    )}
                    {showCommand && !pending.diff_preview && command && (
                        <p class="mt-2 text-[11px] text-base-content/60">{command}</p>
                    )}
                </div>
            </div>
            <div class="grid gap-2 border-t border-warning/20 px-2.5 sm:px-3 py-2.5 sm:py-3 sm:flex sm:flex-wrap">
                <button
                    type="button"
                    class="btn btn-primary btn-sm rounded-full"
                    disabled={disabled || resolving}
                    onClick={() => onApprove(true)}
                >
                    {resolving ? <span class="loading loading-spinner loading-xs" /> : null}
                    Toujours autoriser
                </button>
                <button
                    type="button"
                    class="btn btn-ghost btn-sm rounded-full border border-base-300"
                    disabled={disabled || resolving}
                    onClick={() => onApprove(false)}
                >
                    Autoriser une fois
                </button>
                <button
                    type="button"
                    class="btn btn-ghost btn-sm rounded-full"
                    disabled={disabled || resolving}
                    onClick={onDeny}
                >
                    Jamais
                </button>
            </div>
        </section>
    );
}
