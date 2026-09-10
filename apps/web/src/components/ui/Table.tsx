import type { ComponentChildren } from 'preact';
import { cn } from '../../lib/cn';

export function Table({
  headers,
  children,
  class: className,
}: {
  headers: string[];
  children: ComponentChildren;
  class?: string;
}) {
  return (
    <div
      class={cn(
        'overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)]',
        className,
      )}
    >
      <table class="w-full text-left text-sm">
        <thead class="border-b border-[var(--color-line)] text-xs uppercase tracking-wider text-[var(--color-ink-faint)]">
          <tr>
            {headers.map((h) => (
              <th key={h} class="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({
  children,
  class: className,
}: {
  children: ComponentChildren;
  class?: string;
}) {
  return (
    <tr class={cn('border-b border-[var(--color-line)] last:border-0', className)}>
      {children}
    </tr>
  );
}

export function Td({
  children,
  class: className,
}: {
  children: ComponentChildren;
  class?: string;
}) {
  return <td class={cn('px-4 py-3 text-[var(--color-ink-muted)]', className)}>{children}</td>;
}
