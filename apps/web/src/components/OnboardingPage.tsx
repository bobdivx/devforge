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

type Door = 'choose' | 'fast' | 'custom';
type StepId = 'docker' | 'suite' | 'instance' | 'domain' | 'github' | 'finish';

const FAST_STEPS: { id: StepId; label: string }[] = [
  { id: 'docker', label: 'Docker' },
  { id: 'domain', label: 'Domaine' },
  { id: 'suite', label: 'Première app' },
];

const CUSTOM_STEPS: { id: StepId; label: string }[] = [
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

export function OnboardingWizard() {
  const toast = useToast();
  const [door, setDoor] = useState<Door>('choose');
  const [step, setStep] = useState<StepId>('docker');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boot, setBoot] = useState<Bootstrap | null>(null);

  const [instanceName, setInstanceName] = useState('DevForge');
  const [instanceUrl, setInstanceUrl] = useState('http://localhost:8000');
  const [domain, setDomain] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [joinMode, setJoinMode] = useState(false);
  const [docker, setDocker] = useState<DockerEngineInfo | null>(null);

  const steps = door === 'fast' ? FAST_STEPS : CUSTOM_STEPS;
  const idx = Math.max(0, steps.findIndex((s) => s.id === step));
  const progress = door === 'choose' ? 0 : Math.round(((idx + 1) / steps.length) * 100);

  useEffect(() => {
    api.bootstrap().then((b) => {
      if (b.user && b.user.role !== 'instance_admin') {
        window.location.replace('/app');
        return;
      }
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

  function domainOk() {
    return domain.trim().includes('.');
  }

  async function nextCustom() {
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
        if (!domainOk()) {
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
      const nextStep = steps[idx + 1];
      if (nextStep) setStep(nextStep.id);
    } catch {
      /* error already set */
    }
  }

  async function finishCustom() {
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

  async function finishFast() {
    if (!domainOk()) {
      setError('Domaine invalide (ex. apps.example.com)');
      setStep('domain');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.saveOnboarding({
        instance_name: instanceName.trim() || 'DevForge',
        instance_url: instanceUrl.trim() || 'http://localhost:8000',
        wildcard_domain: domain.trim(),
      });
      await api.completeOnboarding();
      window.location.href = '/app?nouvelle=1';
    } catch (e) {
      setError(String((e as Error).message || e));
      setBusy(false);
    }
  }

  function skipGithub() {
    setStep('finish');
  }

  function choose(next: Door) {
    setError(null);
    setJoinMode(false);
    setDoor(next);
    setStep(next === 'fast' ? 'docker' : 'instance');
  }

  return (
    <div class="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-12">
      <FadeIn>
        {door !== 'choose' && (
          <div class="mb-6">
            <div class="mb-2 flex items-center justify-between text-xs text-[var(--color-ink-faint)]">
              <span>
                {idx + 1} / {steps.length}
              </span>
              <span>{steps[idx]?.label}</span>
            </div>
            <ProgressBar value={progress} />
          </div>
        )}

        <Card padding="lg">
          {error && (
            <Alert tone="danger" class="mb-4">
              {error}
            </Alert>
          )}

          {door === 'choose' && !joinMode && (
            <div class="space-y-4" data-df-doors>
              <h1 class="text-2xl font-semibold tracking-tight">
                Salut{boot?.user ? `, ${boot.user.name}` : ''}
              </h1>
              <p class="text-sm leading-relaxed text-[var(--color-ink-muted)]">
                Deux portes. Le démarrage rapide enchaîne le minimum, puis la première app.
              </p>
              <button
                type="button"
                class="df-invite group w-full rounded-2xl border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] p-4 text-left"
                data-df-door="fast"
                onClick={() => choose('fast')}
              >
                <div class="flex items-center gap-2">
                  <span class="text-base font-semibold">Démarrage rapide</span>
                  <Badge tone="accent">Recommandé</Badge>
                </div>
                <ol class="mt-2 space-y-1 text-sm text-[var(--color-ink-muted)]">
                  <li>1 · Docker</li>
                  <li>2 · Domaine</li>
                  <li>3 · Première app, dans le workspace</li>
                </ol>
              </button>
              <button
                type="button"
                class="w-full rounded-2xl border border-[var(--color-line)] p-4 text-left hover:border-white/20"
                data-df-door="custom"
                onClick={() => choose('custom')}
              >
                <div class="text-base font-semibold">Instance et cluster</div>
                <p class="mt-1 text-sm text-[var(--color-ink-muted)]">
                  Nom, URL, domaine, GitHub. Tu peux sauter GitHub.
                </p>
              </button>
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

          {joinMode && (
            <div class="space-y-4">
              <h1 class="text-2xl font-semibold tracking-tight">Rejoindre un cluster</h1>
              <p class="text-sm text-[var(--color-ink-muted)]">
                Colle le jeton copié sur le leader, puis l’URL à laquelle ce nœud peut le joindre.
                L’URL n’est pas dans le jeton — tu peux mettre le DNS public ou une IP LAN.
              </p>
              <JoinClusterForm
                busy={busy}
                context={{
                  instanceUrl: boot?.settings?.instance_url || instanceUrl,
                  wildcardDomain: boot?.settings?.wildcard_domain || domain,
                  dns: boot?.settings?.dns
                    ? {
                        provider: boot.settings.dns.provider || '',
                        configured: !!boot.settings.dns.configured,
                        zone: boot.settings.dns.zone || '',
                      }
                    : null,
                }}
                onCancel={() => {
                  setJoinMode(false);
                  setError(null);
                }}
                onSubmit={async (body) => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.clusterJoinLocal(body);
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

          {door === 'fast' && step === 'docker' && (
            <div class="space-y-4">
              <h2 class="text-xl font-semibold tracking-tight">1 · Docker</h2>
              <p class="text-sm text-[var(--color-ink-muted)]">
                Les déploiements utilisent Docker sur cette machine. Il n’est pas embarqué.
              </p>
              <DockerEngineAlert docker={docker} />
              {docker && docker.ok === false && (
                <ul class="space-y-1 text-sm text-[var(--color-ink-muted)]">
                  <li>Vérifie que le service Docker tourne.</li>
                  <li>Recharge cette page une fois le moteur joignable.</li>
                </ul>
              )}
              <div class="flex gap-2">
                <Button variant="ghost" onClick={() => setDoor('choose')}>
                  Retour
                </Button>
                <Button class="flex-1" onClick={() => setStep('domain')}>
                  Continuer
                </Button>
              </div>
            </div>
          )}

          {door === 'fast' && step === 'domain' && (
            <div class="space-y-4">
              <h2 class="text-xl font-semibold tracking-tight">2 · Domaine</h2>
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
                <Button variant="ghost" onClick={() => setStep('docker')}>
                  Retour
                </Button>
                <Button
                  class="flex-1"
                  onClick={() => {
                    if (!domainOk()) {
                      setError('Domaine invalide (ex. apps.example.com)');
                      return;
                    }
                    setError(null);
                    setStep('suite');
                  }}
                >
                  Continuer
                </Button>
              </div>
            </div>
          )}

          {door === 'fast' && step === 'suite' && (
            <div class="space-y-4">
              <h2 class="text-xl font-semibold tracking-tight">3 · Première app</h2>
              <p class="text-sm text-[var(--color-ink-muted)]">
                Importe un dépôt ou décris l’app. Tu arrives dans le workspace.
              </p>
              <div class="flex gap-2">
                <Button variant="ghost" onClick={() => setStep('domain')}>
                  Retour
                </Button>
                <Button class="flex-1" disabled={busy} onClick={finishFast}>
                  {busy ? <Spinner /> : null}
                  Ouvrir la première app
                </Button>
              </div>
            </div>
          )}

          {door === 'custom' && step === 'instance' && (
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
                <Button variant="ghost" onClick={() => setDoor('choose')}>
                  Retour
                </Button>
                <Button class="flex-1" disabled={busy} onClick={nextCustom}>
                  {busy ? <Spinner /> : null}
                  Continuer
                </Button>
              </div>
            </div>
          )}

          {door === 'custom' && step === 'domain' && (
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
                <Button class="flex-1" disabled={busy} onClick={nextCustom}>
                  {busy ? <Spinner /> : null}
                  Continuer
                </Button>
              </div>
            </div>
          )}

          {door === 'custom' && step === 'github' && (
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
                <Button variant="outline" onClick={skipGithub}>
                  Plus tard
                </Button>
                <Button class="flex-1" disabled={busy} onClick={nextCustom}>
                  {busy ? <Spinner /> : null}
                  Continuer
                </Button>
              </div>
            </div>
          )}

          {door === 'custom' && step === 'finish' && (
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
                <Button class="flex-1" disabled={busy} onClick={finishCustom}>
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
