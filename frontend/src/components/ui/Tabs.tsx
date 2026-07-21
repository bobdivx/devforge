type TabItem = {
    id: string;
    label: string;
};

type TabsProps = {
    items: TabItem[];
    active: string;
    variant?: 'horizontal' | 'sidebar';
    onChange: (id: string) => void;
};

export function Tabs({ items, active, variant = 'horizontal', onChange }: TabsProps) {
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
                        {items.map((item) => (
                            <option value={item.id} key={item.id}>{item.label}</option>
                        ))}
                    </select>
                </label>

                <nav aria-label="Navigation secondaire" class="hidden min-w-0 lg:block">
                    <ul class="sticky top-4 grid gap-0.5">
                        {items.map((item) => {
                            const selected = active === item.id;

                            return (
                                <li key={item.id}>
                                    <button
                                        class={`w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                                            selected
                                                ? 'bg-primary/10 font-semibold text-primary'
                                                : 'text-base-content/70 hover:bg-base-200/80 hover:text-base-content'
                                        }`}
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
                    {items.map((item) => (
                        <option value={item.id} key={item.id}>{item.label}</option>
                    ))}
                </select>
            </label>

            <div
                class="hidden w-full flex-wrap gap-1.5 rounded-2xl border border-base-300/60 bg-base-200/40 p-1.5 shadow-sm sm:flex"
                role="tablist"
            >
                {items.map((item) => {
                    const selected = active === item.id;

                    return (
                        <button
                            class={`relative rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                                selected
                                    ? 'bg-base-100 text-primary shadow-sm ring-1 ring-base-300/80'
                                    : 'text-base-content/60 hover:bg-base-100/60 hover:text-base-content'
                            }`}
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
