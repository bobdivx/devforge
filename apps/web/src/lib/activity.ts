/**
 * Activité d'un run (P2-04) : textes des pastilles, résumé de fin, fusion live → final.
 * Fonctions pures (testées) ; les composants sont dans components/chat/Activity*.tsx.
 */
import type { AgentReflection, AgentToolCall } from './agent-stream';

export type ActionStatus = 'running' | 'ok' | 'fail';
export type LiveAction = AgentToolCall & { status: ActionStatus };
export type MilestoneState = 'running' | 'done' | 'failed';
export type Milestone = { label: string; status: MilestoneState };

/** Une entrée du groupe d'activité : un outil ou une réflexion. */
export type ActivityItem =
  | { kind: 'tool'; key: string; action: LiveAction }
  | { kind: 'reflection'; key: string; reflection: AgentReflection };

export function fmtElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

function str(call: AgentToolCall, key: string): string {
  const v = call.arguments?.[key];
  return typeof v === 'string' ? v.trim() : '';
}

function base(path: string): string {
  return path.split('/').filter(Boolean).pop() || path;
}

function clip(s: string, max = 42): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

export function statusOf(call: AgentToolCall & { status?: ActionStatus }): ActionStatus {
  if (call.status) return call.status;
  return call.result?.ok === false ? 'fail' : 'ok';
}

/** Texte de pastille : présent pendant (« Lit app.ts… »), passé après (« A lu app.ts »). */
export function pillText(call: LiveAction): string {
  const running = call.status === 'running';
  const path = str(call, 'path') || (typeof call.result?.path === 'string' ? call.result.path : '');
  const file = path ? base(path) : 'un fichier';
  const cmd = clip(str(call, 'command'), 36);
  const dur =
    !running && typeof call.elapsed_ms === 'number' && call.elapsed_ms >= 1000 ? ` · ${fmtElapsed(call.elapsed_ms)}` : '';
  if (call.status === 'fail') {
    const s = (call.summary || '').replace(/^✗\s*/, '');
    return clip(s || `${call.label || call.name.replace(/_/g, ' ')} : échec`, 60);
  }
  switch (call.name) {
    case 'read_project_file':
    case 'read_github_file':
      return running ? `Lit ${file}…` : `A lu ${file}`;
    case 'list_project_files':
      return running ? 'Liste les fichiers…' : 'A listé les fichiers';
    case 'write_project_file':
      return running ? `Écrit ${file}…` : `A modifié ${file}`;
    case 'run_workdir_command':
      return running ? `Lance ${cmd || 'une commande'}…` : `A lancé ${cmd || 'une commande'}${dur}`;
    case 'run_application_tests':
      return running ? 'Lance les tests…' : `A lancé les tests${dur}`;
    case 'start_local_preview':
      return running ? 'Démarre la preview…' : `Preview démarrée${dur}`;
    case 'trigger_deploy':
      return running ? 'Lance le déploiement…' : 'Déploiement lancé';
    case 'http_smoke': {
      const url = clip(str(call, 'url').replace(/^https?:\/\//, ''), 30);
      return running ? `Vérifie ${url || 'le site'}…` : `A vérifié ${url || 'le site'}${dur}`;
    }
    case 'get_project':
      return running ? 'Lit le projet…' : 'A lu le projet';
    case 'propose_plan':
      return running ? 'Prépare un plan…' : 'A proposé un plan';
    case 'sync_workdir_to_github':
      return running ? 'Pousse sur GitHub…' : 'A poussé sur GitHub';
    case 'create_github_fix':
      return running ? 'Ouvre une pull request…' : 'A ouvert une pull request';
    case 'get_deployment_logs':
      return running ? 'Lit les logs…' : 'A lu les logs';
    default: {
      const label = call.label || call.name.replace(/_/g, ' ');
      return running ? `${clip(label)}…` : `${clip(label)}${dur}`;
    }
  }
}

function writtenPath(call: AgentToolCall): string | null {
  if (call.name !== 'write_project_file' || call.result?.ok === false) return null;
  const p = str(call, 'path') || (typeof call.result?.path === 'string' ? call.result.path : '');
  return p || null;
}

/** « 8 actions · 2 fichiers modifiés · 34 s ». */
export function activitySummary(actions: AgentToolCall[], elapsedMs?: number): string {
  const n = actions.length;
  const parts = [`${n} action${n > 1 ? 's' : ''}`];
  const files = new Set(actions.map(writtenPath).filter((p): p is string => !!p));
  if (files.size > 0) parts.push(`${files.size} fichier${files.size > 1 ? 's' : ''} modifié${files.size > 1 ? 's' : ''}`);
  const failed = actions.filter((a) => statusOf(a) === 'fail').length;
  if (failed > 0) parts.push(`${failed} échec${failed > 1 ? 's' : ''}`);
  if (typeof elapsedMs === 'number' && elapsedMs >= 1000) parts.push(fmtElapsed(elapsedMs));
  return parts.join(' · ');
}

/**
 * Continuité live → final : les outils du `Reply` (résultats complets) remplacent les live
 * par id, en gardant les infos d'affichage (libellé, résumé, durée). Ordre du live conservé.
 */
export function mergeLiveFinal(live: LiveAction[], final: AgentToolCall[]): LiveAction[] {
  if (!final.length) return live.map((a) => (a.status === 'running' ? { ...a, status: 'ok' as const } : a));
  const used = new Set<number>();
  const out: LiveAction[] = live.map((a) => {
    const idx = final.findIndex(
      (f, i) => !used.has(i) && (a.call_id && f.call_id ? f.call_id === a.call_id : f.name === a.name),
    );
    if (idx < 0) return a.status === 'running' ? { ...a, status: 'ok' } : a;
    used.add(idx);
    const f = final[idx];
    return {
      ...a,
      ...f,
      label: a.label ?? f.label,
      summary: a.summary ?? f.summary,
      elapsed_ms: a.elapsed_ms ?? f.elapsed_ms,
      status: f.result?.ok === false || a.status === 'fail' ? 'fail' : 'ok',
    };
  });
  final.forEach((f, i) => {
    if (!used.has(i)) out.push({ ...f, status: f.result?.ok === false ? 'fail' : 'ok' });
  });
  return out;
}

/**
 * Outils + réflexions dans l'ordre d'arrivée (`seq`, posé pendant le run). Sans `seq`
 * (historique), les réflexions précèdent les outils.
 */
export function activityItems(
  actions: (LiveAction & { seq?: number })[],
  reflections: (AgentReflection & { seq?: number })[],
): ActivityItem[] {
  const rows: { seq: number; item: ActivityItem }[] = [];
  reflections.forEach((r, i) =>
    rows.push({ seq: r.seq ?? -1_000_000 + i, item: { kind: 'reflection', key: `r-${r.round ?? 0}-${i}`, reflection: r } }),
  );
  actions.forEach((a, i) =>
    rows.push({ seq: a.seq ?? i, item: { kind: 'tool', key: a.call_id || `${a.name}-${i}`, action: a } }),
  );
  return rows.sort((a, b) => a.seq - b.seq).map((r) => r.item);
}

/** Applique un jalon (remplace l'état si déjà présent, sinon ajoute à la fin). */
export function applyMilestone(list: Milestone[], label: string, status: MilestoneState): Milestone[] {
  const i = list.findIndex((m) => m.label === label);
  if (i < 0) return [...list, { label, status }];
  if (list[i].status === status) return list;
  const next = [...list];
  next[i] = { label, status };
  return next;
}
