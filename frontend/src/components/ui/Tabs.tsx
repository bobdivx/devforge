type TabItem = {
    id: string;
    label: string;
};

type TabsProps = {
    items: TabItem[];
    active: string;
    onChange: (id: string) => void;
};

export function Tabs({ items, active, onChange }: TabsProps) {
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
                class="hidden w-full flex-wrap gap-1 rounded-full border border-base-300/70 bg-base-200/60 p-1 shadow-sm sm:flex sm:w-fit"
                role="tablist"
            >
                {items.map((item) => {
                    const selected = active === item.id;

                    return (
                        <button
                            class={`rounded-full px-4 py-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                                selected
                                    ? 'bg-base-100 font-semibold text-primary shadow-sm ring-1 ring-primary/15'
                                    : 'text-base-content/55 hover:bg-base-100/70 hover:text-base-content'
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
