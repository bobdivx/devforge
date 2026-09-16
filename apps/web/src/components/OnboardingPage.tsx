import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import type { Bootstrap } from '../lib/auth';
import { AuthGate } from './AuthGate';
import { DockerEngineAlert, type DockerEngineInfo } from './DockerEngineAlert';
import { JoinClusterForm } from './JoinClusterForm';
import {
  Alert,
  Badge,
  Button,
  Card,
  FadeIn,
  Input,
  ProgressBar,
  PulseDot,
  Spinner,
  useToast,
  ToastProvider,
} from './ui';

type StepId = 'welcome' | 'instance' | 'domain' | 'github' | 'finish';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'welcome', label: 'Accueil' },
  { id: 'instance', label: 'Instance' },
  { id: 'domain', label: 'Domaine' },
  { id: 'github', label: 'GitHub' },
  { id: 'finish', label: 'Terminé' },
];

export function OnboardingPage() {
  return (
    <ToastProvider>
      <AuthGate allowOnboarding>
        <OnboardingWizard />
      </AuthGate>
    </ToastProvider>
  );
}

function OnboardingWizard() {
  const toast = useToast();
  const [step, setStep] = useState<StepId>('welcome');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boot, setBoot] = useState<Bootstrap | null>(null);

  const [instanceName, setInstanceName] = useState('DevForge');
  const [instanceUrl, setInstanceUrl] = useState('http://localhost:8000');
  const [domain, setDomain] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [joinMode, setJoinMode] = useState(false);
  const [docker, setDocker] = useState<DockerEngineInfo | null>(null);

  const idx = STEPS.findIndex((s) => s.id === step);
  const progress = Math.round(((idx + 1) / STEPS.length) * 100);

  useEffect(() => {
    api.bootstrap().then((b) => {
      setBoot(b);
      setInstanceName(b.settings.instance_name || 'DevForge');
      setInstanceUrl(b.settings.instance_url || 'http://localhost:8000');
      setDomain(b.settings.wildcard_domain || '');
    });
    api
      .health()
      .then((h) => setDocker(h.backends?.docker ?? null))
      .catch(() => setDocker(null));
  }, []);

  async function savePartial(body: Record<string, string | undefined>) {
    setBusy(true);
    setError(null);
    try {
      await api.saveOnboarding(body);
      toast.push({ title: 'Enregistré', tone: 'ok' });
    } catch (e) {
      setError(String((e as Error).message || e));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    try {
      if (step === 'instance') {
        if (!instanceName.trim() || !instanceUrl.trim()) {
          setError('Nom et URL requis');
          return;
        }
        await savePartial({
          instance_name: instanceName,
          instance_url: instanceUrl,
        });
      }
      if (step === 'domain') {
        if (!domain.trim() || !domain.includes('.')) {
          setError('Domaine invalide (ex. apps.example.com)');
          return;
        }
        await savePartial({ wildcard_domain: domain });
      }
      if (step === 'github') {
        if (githubToken.trim()) {
          await savePartial({ github_token: githubToken });
        }
      }
      const nextStep = STEPS[idx + 1];
      if (nextStep) setStep(nextStep.id);
    } catch {
      /* error already set */
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await api.completeOnboarding();
      toast.push({ title: 'C’est prêt', tone: 'ok' });
      window.location.href = '/app';
    } catch (e) {
      setError(String((e as Error).message || e));
      setBusy(false);
    }
  }

  function skip() {
    const nextStep = STEPS[idx + 1];
    if (nextStep) setStep(nextStep.id);
  }

  return (
    <div class="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-12">
      <FadeIn>
        <div class="mb-6">
          <div class="mb-2 flex items-center justify-between text-xs text-[var(--color-ink-faint)]">
            <span>
              {idx + 1} / {STEPS.length}
            </span>
            <span>{STEPS[idx]?.label}</span>
          </div>
          <ProgressBar value={progress} />
        </div>

        <Card padding="lg">
          {error && (
            <Alert tone="danger" class="mb-4">
              {error}
            </Alert>
          )}

          {step === 'welcome' && !joinMode && (
            <div class="space-y-4">
              <h1 class="text-2xl font-semibold tracking-tight">
                Salut{boot?.user ? `, ${boot.user.name}` : ''}
              </h1>
              <p class="text-sm leading-relaxed text-[var(--color-ink-muted)]">
                Instance, domaine apps, GitHub. Les déploiements PaaS utilisent Docker installé sur
                cette machine — pas embarqué dans l’exécutable.
              </p>
              <DockerEngineAlert docker={docker} />
              <Button onClick={next} class="w-full">
                Créer une instance
              </Button>
              <Button
                variant="outline"
                class="w-full"
                onClick={() => {
                  setJoinMode(true);
                  setError(null);
                }}
              >
                Rejoindre un cluster
              </Button>
            </div>
          )}

          {step === 'welcome' && joinMode && (
            <div class="space-y-4">
              <h1 class="text-2xl font-semibold tracking-tight">Rejoindre un cluster</h1>
              <p class="text-sm text-[var(--color-ink-muted)]">
                Colle le jeton copié sur le leader, puis l’URL à laquelle ce nœud peut le joindre.
                L’URL n’est pas dans le jeton — tu peux mettre le DNS public ou une IP LAN.
              </p>
              <JoinClusterForm
                busy={busy}
                onCancel={() => {
                  setJoinMode(false);
                  setError(null);
                }}
                onSubmit={async (body) => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.clusterJoinLocal({
                      ...body,
                      advertise_url: window.location.origin,
                    });
                    toast.push({ title: 'Nœud enrôlé', tone: 'ok' });
                    window.location.href = '/app/node';
                  } catch (e) {
                    setError(String((e as Error).message || e));
                    setBusy(false);
                  }
                }}
              />
            </div>
          )}

          {step === 'instance' && (
            <div class="space-y-4">
              <h2 class="text-xl font-semibold tracking-tight">Ton instance</h2>
              <Input
                label="Nom"
                value={instanceName}
                onInput={(e) => setInstanceName((e.target as HTMLInputElement).value)}
              />
              <Input
                label="URL publique"
                value={instanceUrl}
                onInput={(e) => setInstanceUrl((e.target as HTMLInputElement).value)}
                hint="Ex. https://forge.example.com"
              />
              <div class="flex gap-2">
                <Button variant="ghost" onClick={() => setStep('welcome')}>
                  Retour
                </Button>
                <Button class="flex-1" disabled={busy} onClick={next}>
                  {busy ? <Spinner /> : null}
                  Continuer
                </Button>
              </div>
            </div>
          )}

          {step === 'domain' && (
            <div class="space-y-4">
              <h2 class="text-xl font-semibold tracking-tight">Domaine apps</h2>
              <p class="text-sm text-[var(--color-ink-muted)]">
                Les apps seront servies sous <code>*.ton-domaine</code>
              </p>
              <Input
                label="Wildcard"
                placeholder="apps.example.com"
                value={domain}
                onInput={(e) => setDomain((e.target as HTMLInputElement).value)}
              />
              <div class="flex gap-2">
                <Button variant="ghost" onClick={() => setStep('instance')}>
                  Retour
                </Button>
                <Button class="flex-1" disabled={busy} onClick={next}>
                  {busy ? <Spinner /> : null}
                  Continuer
                </Button>
              </div>
            </div>
          )}

          {step === 'github' && (
            <div class="space-y-4">
              <h2 class="text-xl font-semibold tracking-tight">GitHub</h2>
              <p class="text-sm text-[var(--color-ink-muted)]">
                Colle un personal access token (repo + actions). Tu pourras changer plus tard.
              </p>
              {boot?.settings.github_connected && (
                <div class="flex items-center gap-2 text-sm">
                  <PulseDot tone="ok" />
                  <Badge tone="ok">Déjà connecté</Badge>
                </div>
              )}
              <Input
                label="Token"
                type="password"
                placeholder="ghp_…"
                value={githubToken}
                onInput={(e) => setGithubToken((e.target as HTMLInputElement).value)}
              />
              <div class="flex gap-2">
                <Button variant="ghost" onClick={() => setStep('domain')}>
                  Retour
                </Button>
                <Button variant="outline" onClick={skip}>
                  Plus tard
                </Button>
                <Button class="flex-1" disabled={busy} onClick={next}>
                  {busy ? <Spinner /> : null}
                  Continuer
                </Button>
              </div>
            </div>
          )}

          {step === 'finish' && (
            <div class="space-y-4">
              <h2 class="text-xl font-semibold tracking-tight">Tout est en place</h2>
              <ul class="space-y-2 text-sm text-[var(--color-ink-muted)]">
                <li class="flex items-center gap-2">
                  <PulseDot tone="ok" /> Instance · {instanceName || '—'}
                </li>
                <li class="flex items-center gap-2">
                  <PulseDot tone="ok" /> Domaine · {domain || '—'}
                </li>
                <li class="flex items-center gap-2">
                  <PulseDot tone={githubToken || boot?.settings.github_connected ? 'ok' : 'muted'} />{' '}
                  GitHub
                </li>
                <li class="flex items-center gap-2">
                  <PulseDot tone="ok" /> Déplois locaux · Docker socket
                </li>
              </ul>
              <p class="text-xs text-[var(--color-ink-faint)]">
                Serveur SSH distant : Settings → Serveur (optionnel).
              </p>
              <div class="flex gap-2">
                <Button variant="ghost" onClick={() => setStep('github')}>
                  Retour
                </Button>
                <Button class="flex-1" disabled={busy} onClick={finish}>
                  {busy ? <Spinner /> : null}
                  Ouvrir DevForge
                </Button>
              </div>
            </div>
          )}
        </Card>
      </FadeIn>
    </div>
  );
}
