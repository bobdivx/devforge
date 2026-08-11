import { Brain, ExternalLink } from 'lucide-preact';

/** Mémoire = par agent ; ici on explique les scopes et on pointe vers les fiches agent. */
export function AgentsMemoryOverviewPanel() {
    return (
        <div class="grid gap-4">
            <div class="rounded-xl border border-base-300 bg-base-100 p-4">
                <div class="flex items-start gap-3">
                    <div class="grid size-9 place-items-center rounded-xl bg-info/10 text-info">
                        <Brain class="size-4" aria-hidden />
                    </div>
                    <div class="min-w-0">
                        <p class="text-sm font-semibold">Mémoire persistante</p>
                        <p class="mt-1 text-xs leading-relaxed text-base-content/60">
                            Les agents mémorisent des faits via <code class="text-[11px]">memory_write</code> /
                            {' '}<code class="text-[11px]">memory_read</code>. La gestion fine (liste, clear)
                            se fait sur la fiche de chaque agent.
                        </p>
                    </div>
                </div>
            </div>

            <ul class="grid gap-2 sm:grid-cols-3">
                {[
                    { scope: 'agent', title: 'Agent', text: 'Privé à un agent (préférences, style).' },
                    { scope: 'shared', title: 'Équipe', text: 'Conventions partagées à toute l’équipe.' },
                    { scope: 'project', title: 'Projet', text: 'Lié à une application / ressource.' },
                ].map((item) => (
                    <li key={item.scope} class="rounded-xl border border-base-300 bg-base-100 px-3 py-3">
                        <p class="text-xs font-semibold uppercase tracking-wide text-base-content/45">{item.scope}</p>
                        <p class="mt-1 text-sm font-medium">{item.title}</p>
                        <p class="mt-1 text-[11px] text-base-content/60">{item.text}</p>
                    </li>
                ))}
            </ul>

            <a class="btn btn-outline btn-sm w-fit gap-1.5" href="/agents">
                Ouvrir un agent
                <ExternalLink class="size-3.5" aria-hidden />
            </a>
        </div>
    );
}
