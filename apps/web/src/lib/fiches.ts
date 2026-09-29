import type { TimelineStepId } from './deploy-timeline';

export type Fiche = {
  id: string;
  cas: string;
  gestes: string[];
};

const DEPLOY: Record<string, Fiche> = {
  git_sync: {
    id: 'git',
    cas: 'Le dépôt n’a pas pu être récupéré.',
    gestes: [
      'Vérifie le dépôt, la branche et le token GitHub.',
      'Relance le déploiement.',
    ],
  },
  build: {
    id: 'build',
    cas: 'La compilation ou les dépendances ont échoué.',
    gestes: [
      'Lis la dernière erreur dans les logs de cette étape.',
      'Vérifie le pack de build et le dossier de base, puis relance.',
    ],
  },
  container_start: {
    id: 'container',
    cas: 'Le conteneur ne démarre pas.',
    gestes: [
      'Vérifie que Docker répond sur le nœud.',
      'Vérifie le port : un autre conteneur l’occupe peut-être.',
    ],
  },
  healthcheck: {
    id: 'healthcheck',
    cas: 'Le conteneur tourne, la sonde ne reçoit pas 200.',
    gestes: [
      'Vérifie le port et que l’app écoute 0.0.0.0.',
      'Lis les logs du conteneur, puis relance.',
    ],
  },
  blue_green_switch: {
    id: 'routage',
    cas: 'Le domaine ne pointe pas vers le conteneur.',
    gestes: [
      'Vérifie le domaine de l’app.',
      'Le conteneur et le proxy doivent partager un réseau Docker. Relance le déploiement.',
    ],
  },
};

export function ficheForDeployStep(id: TimelineStepId): Fiche | null {
  return DEPLOY[id] ?? null;
}

export type DiagConstat = {
  id: string;
  label: string;
  fiche: Fiche;
};

function sectionsOf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current = '';
  for (const line of raw.split('\n')) {
    const mark = line.match(/^===\s*(.+?)\s*===\s*$/);
    if (mark) {
      current = mark[1].toLowerCase();
      out[current] = '';
      continue;
    }
    if (!current) continue;
    out[current] += `${line}\n`;
  }
  return out;
}

function diskPercents(disk: string): number[] {
  const found: number[] = [];
  for (const match of disk.matchAll(/(\d+)\s*%/g)) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) found.push(n);
  }
  return found;
}

function dockerBroken(docker: string): boolean {
  return /cannot connect|is not recognized|command not found|permission denied|no such file/i.test(
    docker,
  );
}

function dockerRows(docker: string): string[] {
  return docker
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^names\b/i.test(l));
}

/** Constats courts lus dans la capture uptime / disque / docker. */
export function constatsFromDiagnostic(raw: string): DiagConstat[] {
  if (!raw.trim()) return [];
  const sections = sectionsOf(raw);
  const out: DiagConstat[] = [];
  const docker = sections.docker ?? '';
  const broken = dockerBroken(docker);

  if ('docker' in sections && (broken || docker.trim() === '')) {
    out.push({
      id: 'docker',
      label: 'Docker ne répond pas',
      fiche: {
        id: 'docker',
        cas: 'Le moteur Docker ne répond pas sur ce nœud.',
        gestes: [
          'Vérifie que le service Docker tourne.',
          'Les apps de ce nœud ne démarrent pas tant que le socket est injoignable.',
        ],
      },
    });
  }

  const percents = diskPercents(sections.disk ?? '');
  const worst = percents.length ? Math.max(...percents) : 0;
  if (worst >= 90) {
    out.push({
      id: 'disk',
      label: `Disque à ${worst} %`,
      fiche: {
        id: 'disk',
        cas: 'Le disque de ce nœud est presque plein.',
        gestes: [
          'Libère de l’espace sur / ou /data.',
          'Les images Docker inutilisées sont souvent la cause.',
        ],
      },
    });
  }

  if ('docker' in sections && !broken) {
    const rows = dockerRows(docker);
    if (rows.length > 0 && !rows.some((r) => /traefik/i.test(r))) {
      out.push({
        id: 'proxy',
        label: 'Proxy absent',
        fiche: {
          id: 'proxy',
          cas: 'Le proxy n’apparaît pas parmi les conteneurs.',
          gestes: [
            'Sans proxy, le domaine ne joint pas l’app.',
            'Vérifie le conteneur du proxy et le réseau partagé, puis relance le déploiement.',
          ],
        },
      });
    }
  }

  return out;
}
