/**
 * Parser de logs de déploiement pour timeline animée.
 * Extrait les jalons ([git], [blue-green], healthcheck, traefik, build...)
 * et partitionne les logs par étape.
 */

export type TimelineStepId =
  | 'git_sync'
  | 'build'
  | 'container_start'
  | 'healthcheck'
  | 'blue_green_switch'
  | 'done';

export type StepState = 'pending' | 'running' | 'success' | 'failed';

export type TimelineStep = {
  id: TimelineStepId;
  label: string;
  description: string;
  state: StepState;
  logs: string[];
  durationMs?: number;
};

export type ParsedTimeline = {
  steps: TimelineStep[];
  currentStepId: TimelineStepId | null;
  overallState: 'pending' | 'running' | 'success' | 'failed';
  errorSummary?: string;
};

export function parseDeployTimeline(
  rawLogs: string | null | undefined,
  deployStatus: string,
): ParsedTimeline {
  const steps: Record<TimelineStepId, TimelineStep> = {
    git_sync: {
      id: 'git_sync',
      label: 'Synchronisation Git',
      description: 'Récupération du code source et checkout',
      state: 'pending',
      logs: [],
    },
    build: {
      id: 'build',
      label: 'Build & Dépendances',
      description: 'Installation des packages et compilation',
      state: 'pending',
      logs: [],
    },
    container_start: {
      id: 'container_start',
      label: 'Démarrage Conteneur',
      description: 'Lancement du runtime applicatif isolé',
      state: 'pending',
      logs: [],
    },
    healthcheck: {
      id: 'healthcheck',
      label: 'Sonde Healthcheck',
      description: 'Attente de réponse HTTP 200 sur le service',
      state: 'pending',
      logs: [],
    },
    blue_green_switch: {
      id: 'blue_green_switch',
      label: 'Routage & Bascule',
      description: 'Configuration Traefik et basculement zero-downtime',
      state: 'pending',
      logs: [],
    },
    done: {
      id: 'done',
      label: 'Mise en ligne',
      description: 'Déploiement achevé et actif',
      state: 'pending',
      logs: [],
    },
  };

  if (!rawLogs || rawLogs.trim() === '') {
    const isRunning = deployStatus === 'deploying' || deployStatus === 'building';
    if (isRunning) {
      steps.git_sync.state = 'running';
    }
    return {
      steps: Object.values(steps),
      currentStepId: isRunning ? 'git_sync' : null,
      overallState: isRunning ? 'running' : deployStatus === 'failed' ? 'failed' : 'pending',
    };
  }

  const lines = rawLogs.split('\n');
  let currentStep: TimelineStepId = 'git_sync';
  steps.git_sync.state = 'running';

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Détection changement d'étape
    if (lower.includes('[git]') || lower.includes('git clone') || lower.includes('git fetch')) {
      currentStep = 'git_sync';
      if (steps.git_sync.state === 'pending') steps.git_sync.state = 'running';
    } else if (
      lower.includes('npm run build') ||
      lower.includes('pnpm build') ||
      lower.includes('astro build') ||
      lower.includes('[build]') ||
      lower.includes('building')
    ) {
      if (steps.git_sync.state === 'running') steps.git_sync.state = 'success';
      currentStep = 'build';
      if (steps.build.state === 'pending') steps.build.state = 'running';
    } else if (
      lower.includes('[blue-green] starting new container') ||
      lower.includes('starting container') ||
      lower.includes('docker run') ||
      lower.includes('spawning local runtime')
    ) {
      if (steps.git_sync.state === 'running') steps.git_sync.state = 'success';
      if (steps.build.state === 'running') steps.build.state = 'success';
      currentStep = 'container_start';
      if (steps.container_start.state === 'pending') steps.container_start.state = 'running';
    } else if (
      lower.includes('healthcheck') ||
      lower.includes('attente healthcheck') ||
      lower.includes('probing')
    ) {
      if (steps.container_start.state === 'running') steps.container_start.state = 'success';
      currentStep = 'healthcheck';
      if (steps.healthcheck.state === 'pending') steps.healthcheck.state = 'running';
    } else if (
      lower.includes('traefik') ||
      lower.includes('basculement') ||
      lower.includes('renommage') ||
      lower.includes('zero-downtime')
    ) {
      if (steps.healthcheck.state === 'running') steps.healthcheck.state = 'success';
      currentStep = 'blue_green_switch';
      if (steps.blue_green_switch.state === 'pending') steps.blue_green_switch.state = 'running';
    }

    steps[currentStep].logs.push(line);

    // Détection d'erreurs
    if (lower.includes('❌') || lower.includes('error:') || lower.includes('failed')) {
      if (deployStatus === 'failed' || deployStatus === 'error') {
        steps[currentStep].state = 'failed';
      }
    }
  }

  // Ajuster selon statut global
  if (deployStatus === 'deployed' || deployStatus === 'running' || deployStatus === 'success') {
    steps.git_sync.state = 'success';
    steps.build.state = 'success';
    steps.container_start.state = 'success';
    steps.healthcheck.state = 'success';
    steps.blue_green_switch.state = 'success';
    steps.done.state = 'success';
  } else if (deployStatus === 'failed' || deployStatus === 'error') {
    if (steps.blue_green_switch.state === 'running') steps.blue_green_switch.state = 'failed';
    else if (steps.healthcheck.state === 'running') steps.healthcheck.state = 'failed';
    else if (steps.container_start.state === 'running') steps.container_start.state = 'failed';
    else if (steps.build.state === 'running') steps.build.state = 'failed';
    else if (steps.git_sync.state === 'running') steps.git_sync.state = 'failed';
    steps.done.state = 'failed';
  }

  const stepList = Object.values(steps);
  const activeStep = stepList.find((s) => s.state === 'running')?.id || null;

  return {
    steps: stepList,
    currentStepId: activeStep,
    overallState:
      deployStatus === 'deployed' || deployStatus === 'running' || deployStatus === 'success'
        ? 'success'
        : deployStatus === 'failed' || deployStatus === 'error'
        ? 'failed'
        : 'running',
  };
}
