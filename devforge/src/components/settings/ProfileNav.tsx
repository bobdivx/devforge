import { profileTabPath, type ProfileTabId } from '../../lib/profile-tabs';
import { navigateTo } from '../../lib/use-navigate';

type ProfileNavProps = {
    activeTab: ProfileTabId;
};

const tabs: Array<{ id: ProfileTabId; label: string }> = [
    { id: 'account', label: 'Compte' },
    { id: 'appearance', label: 'Apparence' },
];

export function ProfileNav({ activeTab }: ProfileNavProps) {
    return (
        <>
            <label class="form-control w-full sm:hidden">
                <span class="label-text mb-1 text-xs font-medium text-base-content/55">Section</span>
                <select
                    class="select select-bordered select-sm w-full"
                    value={activeTab}
                    onChange={(event) => navigateTo(profileTabPath(event.currentTarget.value as ProfileTabId))}
                >
                    {tabs.map((tab) => (
                        <option value={tab.id} key={tab.id}>{tab.label}</option>
                    ))}
                </select>
            </label>
            <nav aria-label="Sections du profil" class="hidden sm:block">
                <ul class="flex flex-wrap gap-1 rounded-full border border-base-300/70 bg-base-200/60 p-1">
                    {tabs.map((tab) => {
                        const selected = tab.id === activeTab;

                        return (
                            <li key={tab.id}>
                                <button
                                    class={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${
                                        selected
                                            ? 'bg-base-100 font-semibold text-primary shadow-sm ring-1 ring-primary/15'
                                            : 'text-base-content/55 hover:bg-base-100/70 hover:text-base-content'
                                    }`}
                                    type="button"
                                    aria-current={selected ? 'page' : undefined}
                                    onClick={() => navigateTo(profileTabPath(tab.id))}
                                >
                                    {tab.label}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </nav>
        </>
    );
}
