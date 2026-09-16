import type { ClusterNode } from './api';

export function isLeaderNode(n: { role?: string; id: string }) {
  return n.role === 'leader' || n.id === 'default';
}

export function nodeRoleLabel(n: { role?: string; id: string }) {
  return isLeaderNode(n) ? 'Leader' : 'Worker';
}

export function normalizeServerId(serverId?: string | null) {
  const id = (serverId || '').trim();
  return !id || id === '*' ? 'default' : id;
}

export function resolveNode(
  nodes: ClusterNode[],
  serverId?: string | null,
): ClusterNode | { id: string; name: string; role: 'leader' | 'worker'; status: string; drained?: boolean } {
  const id = normalizeServerId(serverId);
  const found = nodes.find((n) => n.id === id);
  if (found) return found;
  return {
    id,
    name: id === 'default' ? 'Leader' : id,
    role: id === 'default' ? 'leader' : 'worker',
    status: nodes.length ? 'offline' : 'online',
  };
}

export function nodeShortLabel(
  nodes: ClusterNode[],
  serverId?: string | null,
): string {
  const n = resolveNode(nodes, serverId);
  return `${nodeRoleLabel(n)} · ${n.name}`;
}
