import type { JSX } from 'preact';
import { cn } from '../../lib/cn';

type Props = JSX.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
};

export function Input({ label, hint, class: className, id, ...rest }: Props) {
  const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  return (
    <label class="flex w-full flex-col gap-1.5 text-sm">
      {label && <span class="font-medium text-[var(--color-ink)]">{label}</span>}
      <input
        id={inputId}
        class={cn(
          'h-10 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-ink)] outline-none',
          'placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent-soft)]',
          className as string,
        )}
        {...rest}
      />
      {hint && <span class="text-xs text-[var(--color-ink-muted)]">{hint}</span>}
    </label>
  );
}
