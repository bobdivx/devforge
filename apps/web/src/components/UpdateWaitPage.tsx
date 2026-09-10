import { useEffect, useState } from 'preact/hooks';
import { AppShell } from './AppShell';
import { Badge, Button, ProgressBar, Spinner } from './ui';

const SERVER_BASE =
  import.meta.env.PUBLIC_SERVER_URL ??
  import.meta.env.PUBLIC_API_URL ??
  'http://127.0.0.1:8000/api/v1';

type Phase = 'waiting' | 'online' | 'ready' | 'timeout';

function qs(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

export function UpdateWaitPage() {
  const target = qs('to');
  const [phase, setPhase] = useState<Phase>('waiting');
  const [version, setVersion] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [detail, setDetail] = useState('Le conteneur DevForge redémarre…');
  const maxAttempts = 90;

  useEffect(() => {
    let cancelled = false;
    let n = 0;
    let sawDown = false;

    const tick = async () => {
      if (cancelled) return;
      n += 1;
      setAttempts(n);
      try {
        const res = await fetch(`${SERVER_BASE}/health`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('health');
        const j = (await res.json()) as { ok?: boolean; version?: string };
        if (!j.ok) throw new Error('not ok');
        const v = j.version ?? null;
        setVersion(v);
        if (!sawDown && n < 3) {
          setDetail('Service joignable, finalisation…');
          setPhase('online');
        } else {
          setPhase('online');
          setDetail('Instance de retour.');
        }
        const targetOk =
          !target ||
          !v ||
          v === target ||
          v.replace(/^v/, '') === target.replace(/^v/, '');
        if (targetOk || sawDown || n >= 4) {
          setPhase('ready');
          setDetail('DevForge est prêt. Rechargement…');
          setTimeout(() => {
            window.location.replace('/app');
          }, 1200);
          return;
        }
      } catch {
        sawDown = true;
        setPhase('waiting');
        setDetail('En attente du redémarrage…');
      }
      if (n >= maxAttempts) {
        setPhase('timeout');
        setDetail('Délai dépassé — vérifie le conteneur puis recharge.');
        return;
      }
      setTimeout(tick, 2000);
    };

    const start = setTimeout(tick, 800);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [target]);

  const pct =
    phase === 'ready'
      ? 100
      : phase === 'timeout'
        ? 100
        : Math.min(95, Math.round((attempts / maxAttempts) * 100));

  return (
    <AppShell skipAuth title="Redémarrage">
      <div class="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <div class="relative mb-8 flex h-28 w-28 items-center justify-center">
          <div class="df-orbit absolute inset-0 rounded-full border border-dashed border-[var(--color-line-strong)]" />
          <div class="df-breathe absolute inset-3 rounded-full bg-[var(--color-accent-soft)]" />
          <span class="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-accent)] df-glow-ring">
            {phase === 'ready' ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <Spinner class="h-6 w-6" />
            )}
          </span>
        </div>

        <h1 class="df-gradient-text text-2xl font-semibold tracking-tight">
          {phase === 'ready'
            ? 'C’est prêt'
            : phase === 'timeout'
              ? 'Toujours hors ligne ?'
              : 'Mise à jour en cours'}
        </h1>
        <p class="mt-2 text-sm text-[var(--color-ink-muted)]">{detail}</p>

        <div class="mt-6 w-full space-y-3">
          <ProgressBar value={pct} />
          <div class="flex flex-wrap items-center justify-center gap-2 text-xs text-[var(--color-ink-faint)]">
            {target && <Badge tone="accent">cible v{target}</Badge>}
            {version && <Badge tone="ok">live v{version}</Badge>}
            <span>
              essai {attempts}/{maxAttempts}
            </span>
          </div>
        </div>

        {phase === 'timeout' && (
          <div class="mt-6 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
              Réessayer
            </Button>
            <Button href="/app" variant="outline">
              Forcer l’ouverture
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
