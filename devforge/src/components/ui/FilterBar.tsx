import { Search, X } from 'lucide-preact';

type FilterBarProps = {
    query: string;
    placeholder?: string;
    onQueryChange: (value: string) => void;
    sort?: string;
    sortOptions?: Array<{ value: string; label: string }>;
    onSortChange?: (value: string) => void;
};

export function FilterBar({
    query,
    placeholder = 'Rechercher…',
    onQueryChange,
    sort,
    sortOptions,
    onSortChange,
}: FilterBarProps) {
    return (
        <div class="flex flex-wrap items-center gap-2">
            <label class="input input-bordered input-sm flex min-w-48 flex-1 items-center gap-2">
                <Search class="size-3.5 text-base-content/45" aria-hidden />
                <input
                    class="grow bg-transparent outline-none"
                    type="search"
                    placeholder={placeholder}
                    value={query}
                    onInput={(event) => onQueryChange(event.currentTarget.value)}
                />
                {query && (
                    <button class="btn btn-ghost btn-xs btn-square" type="button" aria-label="Effacer la recherche" onClick={() => onQueryChange('')}>
                        <X class="size-3" aria-hidden />
                    </button>
                )}
            </label>
            {sortOptions && onSortChange && (
                <select class="select select-bordered select-sm" value={sort} onChange={(event) => onSortChange(event.currentTarget.value)}>
                    {sortOptions.map((option) => (
                        <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                </select>
            )}
        </div>
    );
}
