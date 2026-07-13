import { X } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

type ModalProps = {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ComponentChildren;
    footer?: ComponentChildren;
};

export function Modal({ open, title, onClose, children, footer }: ModalProps) {
    useEffect(() => {
        if (!open) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    if (!open) {
        return null;
    }

    return (
        <div class="modal modal-open">
            <div class="modal-box max-w-lg">
                <div class="mb-3 flex items-start justify-between gap-3">
                    <h2 class="text-sm font-semibold">{title}</h2>
                    <button class="btn btn-ghost btn-sm btn-square" type="button" aria-label="Fermer" onClick={onClose}>
                        <X class="size-4" aria-hidden />
                    </button>
                </div>
                <div class="grid gap-3">{children}</div>
                {footer && <div class="modal-action">{footer}</div>}
            </div>
            <button class="modal-backdrop" type="button" aria-label="Fermer la fenêtre" onClick={onClose} />
        </div>
    );
}
