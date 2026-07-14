import { ActionToolbar } from './ActionToolbar';

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
        <nav class="pagination-nav" aria-label={label}>
            <ActionToolbar>
                <button class="btn btn-sm" type="button" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
                    Précédent
                </button>
                <button class="btn btn-sm" type="button" disabled={page >= lastPage} onClick={() => onPageChange(page + 1)}>
                    Suivant
                </button>
            </ActionToolbar>
            <span class="pagination-label">Page {page} / {lastPage}</span>
        </nav>
    );
}
