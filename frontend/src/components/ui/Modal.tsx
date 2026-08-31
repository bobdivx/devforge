import { X } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect } from 'preact/hooks';

type ModalProps = {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ComponentChildren;
    footer?: ComponentChildren;
    size?: 'md' | 'lg' | 'xl' | '2xl';
    dismissible?: boolean;
};

const sizeClass = {
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-3xl',
    '2xl': 'max-w-4xl',
};

export function Modal({
    open,
    title,
    onClose,
    children,
    footer,
    size = 'md',
    dismissible = true,
}: ModalProps) {
    useEffect(() => {
        if (!open || !dismissible) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose, dismissible]);

    useEffect(() => {
        if (!open || typeof document === 'undefined') {
            return;
        }

        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, [open]);

    if (!open || typeof document === 'undefined') {
        return null;
    }

    return createPortal(
        <div class="modal modal-open z-[100]" role="dialog" aria-modal="true" aria-labelledby="devforge-modal-title">
            <div class={`modal-box ${sizeClass[size]}`}>
                <div class="mb-3 flex items-start justify-between gap-3">
                    <h2 id="devforge-modal-title" class="text-xs sm:text-sm font-semibold">{title}</h2>
                    {dismissible && (
                        <button class="btn btn-ghost btn-sm btn-square" type="button" aria-label="Fermer" onClick={onClose}>
                            <X class="size-4" aria-hidden />
                        </button>
                    )}
                </div>
                <div class="grid gap-3">{children}</div>
                {footer && <div class="modal-action form-actions mt-4">{footer}</div>}
            </div>
            {dismissible ? (
                <button class="modal-backdrop" type="button" aria-label="Fermer la fenêtre" onClick={onClose} />
            ) : (
                <div class="modal-backdrop" aria-hidden />
            )}
        </div>,
        document.body,
    );
}
