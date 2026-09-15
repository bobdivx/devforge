import { useEffect, useState } from 'preact/hooks';
import { Spinner } from './ui';

const SERVER_BASE =
  import.meta.env.PUBLIC_SERVER_URL ??
  import.meta.env.PUBLIC_API_URL ??
  'http://127.0.0.1:8000/api/v1';

type Props = {
  show: boolean;
  onRecovered?: () => void;
};

export function UpdateRecoveryOverlay({ show, onRecovered }: Props) {
  const [attempts, setAttempts] = useState(0);
  const maxAttempts = 60;

  useEffect(() => {
    if (!show) return;

    let cancelled = false;
    let n = 0;

    const tick = async () => {
      if (cancelled) return;
      n += 1;
      setAttempts(n);

      try {
        const res = await fetch(`${SERVER_BASE}/health`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const j = (await res.json()) as { ok?: boolean };
          if (j.ok) {
            if (onRecovered) onRecovered();
            window.location.reload();
            return;
          }
        }
      } catch {
        /* continue */
      }

      if (n >= maxAttempts) {
        return;
      }

      setTimeout(tick, 2000);
    };

    const start = setTimeout(tick, 500);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [show, onRecovered]);

  if (!show) return null;

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg)]/95 backdrop-blur-md"
      style={{ animation: 'fadeIn 0.3s ease-out' }}
    >
      <div class="mx-4 max-w-md space-y-6 text-center">
        <div class="relative mx-auto flex h-24 w-24 items-center justify-center">
          <div
            class="absolute inset-0 rounded-full border border-dashed border-[var(--color-line-strong)]"
            style={{ animation: 'spin 20s linear infinite' }}
          />
          <div
            class="absolute inset-3 rounded-full bg-[var(--color-accent-soft)]"
            style={{ animation: 'pulse 2s ease-in-out infinite' }}
          />
          <span class="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-accent)]">
            <Spinner class="h-6 w-6" />
          </span>
        </div>

        <div class="space-y-2">
          <h2 class="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
            DevForge redémarre…
          </h2>
          <p class="text-sm text-[var(--color-ink-muted)]">
            Mise à jour en cours. Reconnexion automatique dans un instant.
          </p>
        </div>

        <div class="flex items-center justify-center gap-2 text-xs text-[var(--color-ink-faint)]">
          <span>tentative {attempts}/{maxAttempts}</span>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(0.95); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
