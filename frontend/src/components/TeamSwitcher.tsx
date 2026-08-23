import { Users } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { BootstrapTeam } from '../lib/bootstrap';

type TeamSwitcherProps = {
    teams: BootstrapTeam[];
    currentTeam: BootstrapTeam;
    compact?: boolean;
    variant?: 'sidebar' | 'settings';
    ariaLabel?: string;
    onSwitch: (teamId: number) => Promise<void>;
};

export function TeamSwitcher({
    teams,
    currentTeam,
    compact = false,
    variant = 'settings',
    ariaLabel = 'Équipe active',
    onSwitch,
}: TeamSwitcherProps) {
    const [switching, setSwitching] = useState(false);

    if (compact) {
        return (
            <div class="grid h-8 place-items-center" title={currentTeam.name} aria-label={`Équipe active : ${currentTeam.name}`}>
                <Users class="size-3.5 sm:size-4 text-base-content/60" aria-hidden />
            </div>
        );
    }

    const select = (
        <select
            class={`select w-full rounded-xl text-sm ${
                variant === 'settings'
                    ? 'select-md h-11 min-h-11 border-base-300/80 bg-base-200/70'
                    : 'select-sm h-9 min-h-9 border-base-300/70 bg-base-100 text-xs'
            }`}
            value={currentTeam.id}
            disabled={switching || teams.length < 2}
            aria-label={ariaLabel}
            onChange={async (event) => {
                const nextTeamId = Number(event.currentTarget.value);
                if (nextTeamId === currentTeam.id) {
                    return;
                }

                setSwitching(true);
                try {
                    await onSwitch(nextTeamId);
                } finally {
                    setSwitching(false);
                }
            }}
        >
            {teams.map((team) => (
                <option value={team.id} key={team.id}>{team.name}</option>
            ))}
        </select>
    );

    if (variant === 'settings') {
        return (
            <div class="rounded-2xl border border-base-300/70 bg-base-200/40 p-4">
                <div class="mb-3 flex items-start gap-3">
                    <div class="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        <Users class="size-4" aria-hidden />
                    </div>
                    <div class="min-w-0">
                        <p class="text-xs sm:text-sm font-semibold">Équipe active</p>
                        <p class="text-xs text-base-content/55">
                            {teams.length < 2
                                ? 'Une seule équipe disponible sur cette instance.'
                                : 'Changez d’équipe pour afficher les ressources associées.'}
                        </p>
                    </div>
                </div>
                <label class="grid gap-2">
                    <span class="text-xs font-medium text-base-content/55">Sélection</span>
                    {select}
                </label>
                {switching && <p class="mt-2 text-xs text-base-content/45" role="status">Changement d’équipe…</p>}
            </div>
        );
    }

    return (
        <label class="grid gap-1">
            <span class="sr-only">{ariaLabel}</span>
            {select}
        </label>
    );
}
