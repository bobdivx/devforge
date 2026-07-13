type PaginationProps = {
    page: number;
    lastPage: number;
    onPageChange: (page: number) => void;
    label?: string;
};

export function Pagination({ page, lastPage, onPageChange, label = 'Pagination' }: PaginationProps) {
    if (lastPage <= 1) {
        return null;
    }

    return (
        <nav class="flex items-center justify-end gap-2" aria-label={label}>
            <button class="btn btn-sm" type="button" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
                Précédent
            </button>
            <span class="text-xs tabular-nums">Page {page} / {lastPage}</span>
            <button class="btn btn-sm" type="button" disabled={page >= lastPage} onClick={() => onPageChange(page + 1)}>
                Suivant
            </button>
        </nav>
    );
}
