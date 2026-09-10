import type { ComponentChildren, JSX } from 'preact';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--color-accent)] text-zinc-950 hover:brightness-110 active:brightness-95',
  secondary:
    'bg-[var(--color-surface-2)] text-[var(--color-ink)] ring-1 ring-inset ring-[var(--color-line-strong)] hover:bg-[var(--color-surface)]',
  ghost: 'bg-transparent text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]',
  danger: 'bg-[var(--color-danger)] text-zinc-950 hover:brightness-110',
  outline:
    'border border-[var(--color-line-strong)] bg-transparent text-[var(--color-ink)] hover:bg-white/5',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs rounded-lg',
  md: 'h-10 px-4 text-sm rounded-xl',
  lg: 'h-11 px-5 text-sm rounded-xl',
};

type Props = {
  variant?: Variant;
  size?: Size;
  class?: string;
  href?: string;
  target?: string;
  rel?: string;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  children: ComponentChildren;
  onClick?: JSX.MouseEventHandler<HTMLButtonElement>;
};

export function Button({
  variant = 'primary',
  size = 'md',
  class: className,
  href,
  target,
  rel,
  type = 'button',
  disabled,
  children,
  onClick,
}: Props) {
  const cls = cn(
    'inline-flex items-center justify-center gap-2 font-medium tracking-tight transition disabled:opacity-50',
    variants[variant],
    sizes[size],
    className,
  );
  if (href) {
    return (
      <a href={href} class={cls} target={target} rel={rel ?? (target === '_blank' ? 'noreferrer' : undefined)}>
        {children}
      </a>
    );
  }
  return (
    <button type={type} class={cls} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
