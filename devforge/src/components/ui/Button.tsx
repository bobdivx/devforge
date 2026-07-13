import type { ComponentChildren } from 'preact';

type ButtonProps = {
    children: ComponentChildren;
    variant?: 'primary' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
    type?: 'button' | 'submit';
    disabled?: boolean;
    class?: string;
    onClick?: (event: MouseEvent) => void;
    'aria-label'?: string;
};

const variants = {
    primary: 'btn-primary',
    ghost: 'btn-ghost',
    danger: 'btn-error btn-outline',
};

const sizes = {
    sm: 'btn-sm',
    md: '',
};

export function Button({
    children,
    variant = 'primary',
    size = 'md',
    type = 'button',
    disabled = false,
    class: className = '',
    onClick,
    'aria-label': ariaLabel,
}: ButtonProps) {
    return (
        <button
            class={`btn ${variants[variant]} ${sizes[size]} ${className}`.trim()}
            type={type}
            disabled={disabled}
            onClick={onClick}
            aria-label={ariaLabel}
        >
            {children}
        </button>
    );
}
