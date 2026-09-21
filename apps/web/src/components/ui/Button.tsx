import type { ComponentChildren, JSX } from 'preact';
import { cn } from '../../lib/cn';
import { pressScale } from '../../lib/motion';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--color-accent)] text-zinc-950 hover:brightness-110 active:brightness-95 shadow-[0_0_0_0_rgb(167_139_250/0)] hover:shadow-[0_8px_28px_rgb(167_139_250/0.28)]',
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
  /** Associe un submit hors `<form>` (footer de Modal). */
  form?: string;
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
  form,
  disabled,
  children,
  onClick,
}: Props) {
  const cls = cn(
    'inline-flex cursor-pointer items-center justify-center gap-2 font-medium tracking-tight transition-[filter,background-color,color,opacity,box-shadow] duration-200 ease-out disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    sizes[size],
    className,
  );
  const animate = disabled ? undefined : pressScale();

  if (href) {
    return (
      <a
        href={href}
        class={cls}
        target={target}
        rel={rel ?? (target === '_blank' ? 'noreferrer' : undefined)}
        animate={animate}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type={type}
      form={form}
      class={cls}
      disabled={disabled}
      onClick={onClick}
      animate={animate}
    >
      {children}
    </button>
  );
}
