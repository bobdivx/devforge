import type { ClusterNode } from '../lib/api';
import { isLeaderNode, nodeRoleLabel, normalizeServerId } from '../lib/cluster-display';

type NodeOption = {
  id: string;
  name: string;
  status?: string;
  role?: string;
  drained?: boolean;
};

export function NodeSelect({
  nodes,
  value,
  onChange,
  disabled,
  hint,
}: {
  nodes: ClusterNode[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const current = normalizeServerId(value);
  const list: NodeOption[] = nodes.length
    ? [...nodes].sort(
        (a, b) =>
          Number(isLeaderNode(b)) - Number(isLeaderNode(a)) || a.name.localeCompare(b.name),
      )
    : [{ id: 'default', name: 'Leader', status: 'online', role: 'leader' }];

  return (
    <label class="flex flex-col gap-1.5 text-sm">
      <span class="font-medium">Nœud de déploiement</span>
      <select
        class="h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3"
        value={current}
        disabled={disabled}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      >
        {list.map((n) => (
          <option key={n.id} value={n.id} disabled={Boolean(n.drained) && n.id !== current}>
            {nodeRoleLabel(n)} · {n.name}
            {n.drained ? ' (drain)' : n.status && n.status !== 'online' ? ` (${n.status})` : ''}
          </option>
        ))}
      </select>
      {hint ? <span class="text-xs text-[var(--color-ink-muted)]">{hint}</span> : null}
    </label>
  );
}
