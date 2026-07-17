import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-preact';

export type Toast = {
    id: number;
    message: string;
    tone: 'success' | 'info' | 'warning';
};

type ToastRegionProps = {
    toasts: Toast[];
    onDismiss: (id: number) => void;
};

const toneClasses = {
    success: 'alert-success',
    info: 'alert-info',
    warning: 'alert-warning',
};

const toneIcons = {
    success: CheckCircle2,
    info: Info,
    warning: TriangleAlert,
};

export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
    return (
        <div class="toast toast-end toast-top z-50 p-2" aria-live="polite" aria-label="Notifications">
            {toasts.map((toast) => {
                const Icon = toneIcons[toast.tone];

                return (
                    <div class={`alert min-h-10 max-w-sm border border-base-300 p-2 text-xs ${toneClasses[toast.tone]}`} role="status" key={toast.id}>
                        <Icon class="size-4 shrink-0" aria-hidden />
                        <span>{toast.message}</span>
                        <button
                            class="btn btn-ghost btn-xs"
                            type="button"
                            aria-label="Fermer la notification"
                            onClick={() => onDismiss(toast.id)}
                        >
                            <X class="size-4" aria-hidden />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
