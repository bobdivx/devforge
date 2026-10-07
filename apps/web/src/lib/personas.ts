import type { Deployment, ProjectAgent, SpecFeature } from './api';

/**
 * Personnages DevForge — couche d'affichage uniquement.
 * Les agents backend gardent leurs rôles (coordinator, ops, deploy…) ;
 * on les présente sous quatre visages simples.
 */
export type PersonaKey = 'braise' | 'phare' | 'rustine' | 'plume';

export type Persona = {
  key: PersonaKey;
  name: string;
  /** Rôle en une ligne (« bâtisseuse de … » pour Braise). */
  role: string;
  tagline: string;
  /** Couleur d'accent (pastilles, liserés). */
  color: string;
};

export const PERSONAS: Record<PersonaKey, Persona> = {
  braise: {
    key: 'braise',
    name: 'Braise',
    role: 'Construit ce que tu demandes',
    tagline: 'Tu parles, je construis. Rien ne part en ligne sans ton OK.',
    color: '#fb923c',
  },
  phare: {
    key: 'phare',
    name: 'Phare',
    role: 'Veille sur l’app en ligne',
    tagline: 'Je surveille la santé, les mises en ligne et les tâches planifiées.',
    color: '#38bdf8',
  },
  rustine: {
    key: 'rustine',
    name: 'Rustine',
    role: 'Répare quand ça casse',
    tagline: 'Quand une mise en ligne échoue, je trouve la cause et je propose une réparation.',
    color: '#2dd4bf',
  },
  plume: {
    key: 'plume',
    name: 'Plume',
    role: 'Relit le code',
    tagline: 'Je relis, je repère les risques et je garde les notes.',
    color: '#a78bfa',
  },
};

export const PERSONA_ORDER: PersonaKey[] = ['braise', 'phare', 'rustine', 'plume'];

/** « bâtisseuse de Vigie » */
export function braiseTitle(appName?: string | null): string {
  const name = (appName || '').trim();
  return name ? `bâtisseuse de ${name}` : 'bâtisseuse de ton app';
}

const PHARE_ROLES = new Set(['ops', 'deploy', 'runner', 'actions', 'crons']);
const REPAIR_EVENTS = new Set(['deploy_fail', 'unhealthy', 'unrouted']);

function triggerEvent(agent: ProjectAgent): string | undefined {
  if (agent.trigger_type !== 'event' || !agent.trigger_config) return undefined;
  try {
    const cfg = JSON.parse(agent.trigger_config) as { event?: string };
    return cfg.event;
  } catch {
    return undefined;
  }
}

/** Rôle backend → personnage. `null` = pas affiché dans l'équipe. */
export function personaForAgent(agent: ProjectAgent): PersonaKey | null {
  if (agent.role === 'coordinator') return 'braise';
  if (agent.kind === 'subagent' || agent.role === 'worker') return 'braise';
  if (agent.role === 'reviewer') return 'plume';
  if (PHARE_ROLES.has(agent.role)) return 'phare';
  const isRoutine = agent.trigger_type === 'cron' || agent.trigger_type === 'event';
  if (isRoutine) {
    const ev = triggerEvent(agent);
    if (ev && REPAIR_EVENTS.has(ev)) return 'rustine';
    return 'phare';
  }
  // Fils libres (tâches isolées) : Braise.
  if (agent.kind === 'custom') return 'braise';
  return null;
}

export type PersonaTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';

export type PersonaStatus = {
  persona: Persona;
  label: string;
  tone: PersonaTone;
  /** Détail optionnel, uniquement à partir de données réelles. */
  detail?: string;
  agents: ProjectAgent[];
};

function isRoutine(a: ProjectAgent) {
  return a.trigger_type === 'cron' || a.trigger_type === 'event';
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n > 1 ? many : one}`;
}

/** Statut réel par personnage, à partir des agents, des specs et du dernier déploiement. */
export function teamStatus(
  agents: ProjectAgent[],
  specs: SpecFeature[],
  latestDeploy: Deployment | null,
): PersonaStatus[] {
  const by: Record<PersonaKey, ProjectAgent[]> = { braise: [], phare: [], rustine: [], plume: [] };
  for (const a of agents) {
    const k = personaForAgent(a);
    if (k) by[k].push(a);
  }

  const out: PersonaStatus[] = [];

  // Braise
  {
    const list = by.braise;
    const working = list.some((a) => a.status === 'working');
    const active = specs.filter((s) => !s.dismissed);
    const awaiting = active.filter((s) => s.phase === 'awaiting_validation');
    const building = active.filter((s) => s.phase === 'implement');
    const ready = active.filter((s) => s.phase === 'converged');
    let label = 'Prête';
    let tone: PersonaTone = 'ok';
    let detail: string | undefined;
    if (awaiting.length) {
      label = 'Attend ton OK';
      tone = 'warn';
      detail = awaiting[0].title;
    } else if (working || building.length) {
      label = 'Construit…';
      tone = 'accent';
      detail = building[0]?.title;
    } else if (ready.length) {
      label = 'Aperçu prêt';
      tone = 'ok';
      detail = ready[0].title;
    } else if (!list.length) {
      label = 'Indisponible';
      tone = 'neutral';
    }
    out.push({ persona: PERSONAS.braise, label, tone, detail, agents: list });
  }

  // Phare
  {
    const list = by.phare;
    const enabled = list.filter((a) => a.enabled !== 0);
    const routines = enabled.filter(isRoutine);
    const working = enabled.some((a) => a.status === 'working');
    let label: string;
    let tone: PersonaTone;
    if (!list.length) {
      label = 'Absent';
      tone = 'neutral';
    } else if (working) {
      label = 'En ronde';
      tone = 'accent';
    } else if (enabled.length) {
      label = 'Veille';
      tone = 'ok';
    } else {
      label = 'En pause';
      tone = 'neutral';
    }
    const detail = routines.length ? plural(routines.length, 'routine active', 'routines actives') : undefined;
    out.push({ persona: PERSONAS.phare, label, tone, detail, agents: list });
  }

  // Rustine
  {
    const list = by.rustine;
    const enabled = list.filter((a) => a.enabled !== 0);
    const failed = latestDeploy && (latestDeploy.status === 'failed' || latestDeploy.status === 'error');
    let label: string;
    let tone: PersonaTone;
    let detail: string | undefined;
    if (enabled.some((a) => a.status === 'working')) {
      label = 'Répare…';
      tone = 'accent';
    } else if (failed) {
      label = 'Une panne à regarder';
      tone = 'danger';
      detail = 'La dernière mise en ligne a échoué';
    } else if (enabled.length) {
      label = 'Au repos';
      tone = 'ok';
      detail = plural(enabled.length, 'alerte branchée', 'alertes branchées');
    } else {
      label = 'Au repos';
      tone = 'neutral';
    }
    out.push({ persona: PERSONAS.rustine, label, tone, detail, agents: list });
  }

  // Plume
  {
    const list = by.plume;
    const enabled = list.filter((a) => a.enabled !== 0);
    let label: string;
    let tone: PersonaTone;
    if (!list.length) {
      label = 'Absente';
      tone = 'neutral';
    } else if (enabled.some((a) => a.status === 'working')) {
      label = 'Relit…';
      tone = 'accent';
    } else if (enabled.length) {
      label = 'Disponible';
      tone = 'ok';
    } else {
      label = 'En pause';
      tone = 'neutral';
    }
    out.push({ persona: PERSONAS.plume, label, tone, agents: list });
  }

  return out;
}
