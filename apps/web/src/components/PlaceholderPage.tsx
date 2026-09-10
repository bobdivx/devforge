import { AppShell } from './AppShell';
import { Card } from './ui';

type Props = { active: string; title: string; body: string };

export function PlaceholderPage({ active, title, body }: Props) {
  return (
    <AppShell active={active} title={title}>
      <Card>
        <p class="text-sm text-[var(--color-ink-muted)]">{body}</p>
      </Card>
    </AppShell>
  );
}
