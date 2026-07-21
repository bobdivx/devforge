import { Modal } from './Modal';
import { Button } from './Button';

type ConfirmDialogProps = {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'danger' | 'primary';
    loading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    secondaryConfirmLabel?: string;
    onSecondaryConfirm?: () => void;
};

export function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = 'Confirmer',
    cancelLabel = 'Annuler',
    tone = 'primary',
    loading = false,
    onConfirm,
    onCancel,
    secondaryConfirmLabel,
    onSecondaryConfirm,
}: ConfirmDialogProps) {
    return (
        <Modal
            open={open}
            title={title}
            onClose={onCancel}
            footer={(
                <>
                    <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
                    {secondaryConfirmLabel && onSecondaryConfirm && (
                        <Button variant="ghost" disabled={loading} onClick={onSecondaryConfirm}>
                            {loading ? 'En cours…' : secondaryConfirmLabel}
                        </Button>
                    )}
                    <Button variant={tone === 'danger' ? 'danger' : 'primary'} disabled={loading} onClick={onConfirm}>
                        {loading ? 'En cours…' : confirmLabel}
                    </Button>
                </>
            )}
        >
            <p class="text-sm text-base-content/70">{message}</p>
        </Modal>
    );
}
