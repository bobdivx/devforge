import type { ProjectAgent } from '../../lib/api';

/** Libellés, descriptions et suggestions par rôle d'agent. */
export const ROLE_META: Record<string, { label: string; blurb: string; starters: string[] }> = {
  coordinator: {
    label: 'Coordinateur',
    blurb: 'Fil permanent du projet — contexte accumulé, workers éphémères',
    starters: ['Où en est le projet ?', 'Que s’est-il passé récemment ?', 'Propose un plan pour la prochaine étape'],
  },
  ops: {
    label: 'Ops',
    blurb: 'Santé, logs, environnement',
    starters: ['Où en est la santé du projet ?', 'Montre les derniers logs', 'Les variables d’env sont-elles cohérentes ?'],
  },
  deploy: {
    label: 'Déploiements',
    blurb: 'Builds, versions, logs de déploiement',
    starters: ['Quel est le statut du dernier déploiement ?', 'Pourquoi le dernier build a échoué ?', 'Quelle version est en ligne ?'],
  },
  runner: {
    label: 'Runners',
    blurb: 'Runners GitHub du dépôt',
    starters: ['Les runners sont-ils en ligne ?', 'Un runner est-il occupé ou en erreur ?'],
  },
  actions: {
    label: 'Actions',
    blurb: 'Workflows et jobs CI',
    starters: ['Quel est le dernier workflow ?', 'Y a-t-il un job en échec ?'],
  },
  crons: {
    label: 'Crons',
    blurb: 'Tâches planifiées du projet',
    starters: ['Quelles tâches sont actives ?', 'La dernière exécution a-t-elle échoué ?'],
  },
  reviewer: {
    label: 'Revue',
    blurb: 'Risques, qualité, CI',
    starters: ['Lance une revue sécurité du projet', 'Quels risques vois-tu ?', 'La CI est-elle verte ?'],
  },
  custom: {
    label: 'Agent',
    blurb: 'Assistant projet',
    starters: ['Où en est le projet ?', 'Améliore le design en local', 'Déploie la dernière version'],
  },
  worker: { label: 'Worker', blurb: 'Sous-tâche', starters: [] },
};

export const THREAD_STARTERS = ['Où en est le projet ?', 'Améliore le design en local', 'Déploie la dernière version'];

export function metaFor(agent: ProjectAgent) {
  if (agent.kind === 'subagent') {
    return { label: agent.name || 'Sous-agent', blurb: 'Worker éphémère sous le Coordinateur', starters: [] as string[] };
  }
  return ROLE_META[agent.role] || ROLE_META.custom;
}

export function sortByRecent(a: ProjectAgent, b: ProjectAgent) {
  return (b.updated_at || '').localeCompare(a.updated_at || '');
}

/** Coordinateur piné en tête ; le reste par activité récente. */
export function sortAgentsPinned(list: ProjectAgent[]): ProjectAgent[] {
  const coord = list.filter((a) => a.role === 'coordinator');
  const rest = list.filter((a) => a.role !== 'coordinator').sort(sortByRecent);
  return [...coord, ...rest];
}

export type AgentRow = { agent: ProjectAgent; depth: number };

/** Racines + enfants kind=subagent indentés sous leur parent. */
export function nestAgentRows(roots: ProjectAgent[], all: ProjectAgent[]): AgentRow[] {
  const byParent = new Map<string, ProjectAgent[]>();
  for (const a of all) {
    if (a.kind !== 'subagent' || !a.parent_agent_uuid) continue;
    const kids = byParent.get(a.parent_agent_uuid) ?? [];
    kids.push(a);
    byParent.set(a.parent_agent_uuid, kids);
  }
  for (const kids of byParent.values()) kids.sort(sortByRecent);
  const seen = new Set<string>();
  const out: AgentRow[] = [];
  for (const root of roots) {
    if (seen.has(root.uuid)) continue;
    seen.add(root.uuid);
    out.push({ agent: root, depth: 0 });
    for (const kid of byParent.get(root.uuid) ?? []) {
      if (seen.has(kid.uuid)) continue;
      seen.add(kid.uuid);
      out.push({ agent: kid, depth: 1 });
    }
  }
  // Orphelins (parent hors liste) — toujours visibles
  for (const a of all) {
    if (a.kind !== 'subagent' || seen.has(a.uuid)) continue;
    out.push({ agent: a, depth: 1 });
    seen.add(a.uuid);
  }
  return out;
}

export function titleFromMessage(text: string) {
  const oneLine = text.trim().replace(/\s+/g, ' ');
  return oneLine.length <= 48 ? oneLine : `${oneLine.slice(0, 48)}…`;
}

/** Nom affiché d'un fil (jamais Ops / Deploy / Reviewer comme nom de chat). */
export function threadLabel(a: ProjectAgent) {
  if (a.role === 'coordinator') return 'Coordinateur';
  if (a.kind === 'subagent') return a.name || 'Sous-agent';
  if (a.kind === 'custom') return a.name;
  if (a.role === 'deploy' || a.name === 'Deploy') return 'Construction';
  if (a.name === 'Nouveau chat' || a.name === 'Tâche isolée') return a.name;
  return a.name.startsWith('Chat') ? a.name : 'Chat';
}

const threadStorageKey = (projectUuid: string) => `devforge.workspaceThread.${projectUuid}`;

export function readStoredThread(projectUuid: string): string | null {
  try {
    return localStorage.getItem(threadStorageKey(projectUuid));
  } catch {
    return null;
  }
}

export function storeThread(projectUuid: string, agentUuid: string) {
  try {
    localStorage.setItem(threadStorageKey(projectUuid), agentUuid);
  } catch {
    // Navigation privée
  }
}
