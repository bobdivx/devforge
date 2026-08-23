type TabItem = {
    id: string;
    label: string;
};

export type TabGroup = {
    id: string;
    label: string;
    items: TabItem[];
};

type TabsProps = {
    items?: TabItem[];
    groups?: TabGroup[];
    active: string;
    variant?: 'horizontal' | 'sidebar';
    onChange: (id: string) => void;
};

function flattenTabs(items: TabItem[] | undefined, groups: TabGroup[] | undefined): TabItem[] {
    if (groups && groups.length > 0) {
        return groups.flatMap((group) => group.items);
    }

    return items ?? [];
}

function tabButtonClass(selected: boolean, variant: 'horizontal' | 'sidebar'): string {
    if (variant === 'sidebar') {
        return `w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${
            selected
                ? 'bg-primary/10 font-semibold text-primary'
                : 'text-base-content/65 hover:bg-base-200/80 hover:text-base-content'
        }`;
    }

    return `relative rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
        selected
            ? 'bg-base-100 text-primary ring-1 ring-base-300/80'
            : 'text-base-content/55 hover:bg-base-100/70 hover:text-base-content'
    }`;
}

export function Tabs({ items, groups, active, variant = 'horizontal', onChange }: TabsProps) {
    const resolvedItems = flattenTabs(items, groups);
    const showGroups = Boolean(groups && groups.length > 0 && variant === 'sidebar');

    if (variant === 'sidebar') {
        return (
            <>
                <label class="form-control w-full lg:hidden">
                    <span class="sr-only">Onglet actif</span>
                    <select
                        class="select select-bordered select-sm w-full"
                        value={active}
                        onChange={(event) => onChange(event.currentTarget.value)}
                    >
                        {groups && groups.length > 0
                            ? groups.map((group) => (
                                <optgroup label={group.label} key={group.id}>
                                    {group.items.map((item) => (
                                        <option value={item.id} key={item.id}>{item.label}</option>
                                    ))}
                                </optgroup>
                            ))
                            : resolvedItems.map((item) => (
                                <option value={item.id} key={item.id}>{item.label}</option>
                            ))}
                    </select>
                </label>

                <nav aria-label="Navigation secondaire" class="hidden min-w-0 lg:block">
                    <ul class="sticky top-4 grid gap-2.5 sm:gap-3 md:gap-4">
                        {showGroups && groups
                            ? groups.map((group) => (
                                <li key={group.id}>
                                    <p class="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-base-content/40">
                                        {group.label}
                                    </p>
                                    <ul class="grid gap-0.5">
                                        {group.items.map((item) => {
                                            const selected = active === item.id;

                                            return (
                                                <li key={item.id}>
                                                    <button
                                                        class={tabButtonClass(selected, 'sidebar')}
                                                        type="button"
                                                        role="tab"
                                                        aria-selected={selected}
                                                        onClick={() => onChange(item.id)}
                                                    >
                                                        {item.label}
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </li>
                            ))
                            : resolvedItems.map((item) => {
                                const selected = active === item.id;

                                return (
                                    <li key={item.id}>
                                        <button
                                            class={tabButtonClass(selected, 'sidebar')}
                                            type="button"
                                            role="tab"
                                            aria-selected={selected}
                                            onClick={() => onChange(item.id)}
                                        >
                                            {item.label}
                                        </button>
                                    </li>
                                );
                            })}
                    </ul>
                </nav>
            </>
        );
    }

    return (
        <>
            <label class="form-control w-full sm:hidden">
                <span class="sr-only">Onglet actif</span>
                <select
                    class="select select-bordered select-sm w-full"
                    value={active}
                    onChange={(event) => onChange(event.currentTarget.value)}
                >
                    {resolvedItems.map((item) => (
                        <option value={item.id} key={item.id}>{item.label}</option>
                    ))}
                </select>
            </label>

            <div
                class="hidden w-full flex-wrap gap-1 rounded-2xl bg-base-200/60 p-1.5 sm:flex"
                role="tablist"
            >
                {resolvedItems.map((item) => {
                    const selected = active === item.id;

                    return (
                        <button
                            class={tabButtonClass(selected, 'horizontal')}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            key={item.id}
                            onClick={() => onChange(item.id)}
                        >
                            {item.label}
                        </button>
                    );
                })}
            </div>
        </>
    );
}
