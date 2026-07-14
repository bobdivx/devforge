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
        <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <label class="input input-bordered input-sm flex w-full min-w-0 items-center gap-2 sm:min-w-48 sm:flex-1">
                <Search class="size-3.5 shrink-0 text-base-content/45" aria-hidden />
                <input
                    class="min-w-0 grow bg-transparent outline-none"
                    type="search"
                    placeholder={placeholder}
                    value={query}
                    onInput={(event) => onQueryChange(event.currentTarget.value)}
                />
                {query && (
                    <button class="btn btn-ghost btn-xs btn-square shrink-0" type="button" aria-label="Effacer la recherche" onClick={() => onQueryChange('')}>
                        <X class="size-3" aria-hidden />
                    </button>
                )}
            </label>
            {sortOptions && onSortChange && (
                <select class="select select-bordered select-sm w-full sm:w-auto" value={sort} onChange={(event) => onSortChange(event.currentTarget.value)}>
                    {sortOptions.map((option) => (
                        <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                </select>
            )}
        </div>
    );
}
