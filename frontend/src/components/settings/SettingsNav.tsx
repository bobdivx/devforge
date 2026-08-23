import {
    groupedVisibleSettingsTabs,
    settingsTabPath,
    type SettingsTabGroup,
    type SettingsTabId,
} from '../../lib/settings-tabs';
import { navigateTo } from '../../lib/use-navigate';

type SettingsNavProps = {
    activeTab: SettingsTabId;
    agentsEnabled: boolean;
    instanceAdmin: boolean;
};

function NavGroups({
    groups,
    activeTab,
    variant,
}: {
    groups: SettingsTabGroup[];
    activeTab: SettingsTabId;
    variant: 'mobile' | 'desktop';
}) {
    if (variant === 'mobile') {
        return (
            <label class="form-control w-full lg:hidden">
                <span class="label-text mb-1 text-xs font-medium text-base-content/55">Section</span>
                <select
                    class="select select-bordered select-sm w-full"
                    value={activeTab}
                    onChange={(event) => navigateTo(settingsTabPath(event.currentTarget.value as SettingsTabId))}
                >
                    {groups.map((group) => (
                        <optgroup label={group.label} key={group.id}>
                            {group.tabs.map((tab) => (
                                <option value={tab.id} key={tab.id}>{tab.label}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
            </label>
        );
    }

    return (
        <nav aria-label="Sections des paramètres" class="hidden min-w-0 lg:block">
            <ul class="sticky top-4 grid gap-3 sm:gap-4 md:gap-5">
                {groups.map((group) => (
                    <li key={group.id}>
                        <p class="mb-2 px-2 text-[11px] font-semibold uppercase tracking-widest text-base-content/40">
                            {group.label}
                        </p>
                        <ul class="grid gap-0.5">
                            {group.tabs.map((tab) => {
                                const selected = tab.id === activeTab;

                                return (
                                    <li key={tab.id}>
                                        <button
                                            class={`w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                                                selected
                                                    ? 'bg-primary/10 font-semibold text-primary'
                                                    : 'text-base-content/70 hover:bg-base-200/80 hover:text-base-content'
                                            }`}
                                            type="button"
                                            aria-current={selected ? 'page' : undefined}
                                            onClick={() => navigateTo(settingsTabPath(tab.id))}
                                        >
                                            {tab.label}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </li>
                ))}
            </ul>
        </nav>
    );
}

export function SettingsNav({ activeTab, agentsEnabled, instanceAdmin }: SettingsNavProps) {
    const groups = groupedVisibleSettingsTabs(agentsEnabled, instanceAdmin);

    return (
        <>
            <NavGroups groups={groups} activeTab={activeTab} variant="mobile" />
            <NavGroups groups={groups} activeTab={activeTab} variant="desktop" />
        </>
    );
}
