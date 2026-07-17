import type { ComponentChildren } from 'preact';

type ActionToolbarProps = {
    children: ComponentChildren;
    class?: string;
};

export function ActionToolbar({ children, class: className = '' }: ActionToolbarProps) {
    return (
        <div class={`action-toolbar ${className}`.trim()}>
            {children}
        </div>
    );
}
