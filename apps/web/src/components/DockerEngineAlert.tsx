import { Alert } from './ui';

export type DockerEngineInfo = {
  ok?: boolean;
  version?: string | null;
  hint?: string;
};

export function DockerEngineAlert({ docker }: { docker?: DockerEngineInfo | null }) {
  if (!docker) return null;
  if (docker.ok) {
    return (
      <Alert tone="ok">
        Docker{docker.version ? ` ${docker.version}` : ''} détecté — les apps se déploient en
        conteneurs.
      </Alert>
    );
  }
  return (
    <Alert tone="warn">
      {docker.hint || 'Docker n’est pas détecté.'}{' '}
      <a
        class="underline"
        href="https://docs.docker.com/get-docker/"
        target="_blank"
        rel="noreferrer"
      >
        Installer Docker
      </a>
      . DevForge tourne sans, mais les déploiements PaaS (build, Traefik, isolation) ont besoin du
      moteur — on ne l’embarque pas dans l’exécutable.
    </Alert>
  );
}
