import { useEffect, useState } from 'preact/hooks';
import { api } from '../../lib/api';

/** État du modèle (prêt / indisponible / erreur de fournisseur). */
export function useLlmStatus(deps: unknown[] = []) {
  const [mode, setMode] = useState<string>('—');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const status = await api.llmStatus();
        const m = status.mode || 'stub';
        if (!alive) return;
        setMode(m);
        if (m === 'stub') {
          const providers = await api.llmProviders();
          const unhealthy = providers.data.filter((p) => p.enabled && p.healthy === false);
          if (alive) setError(unhealthy.length > 0 ? unhealthy[0].last_probe_error || 'provider unhealthy' : null);
        } else setError(null);
      } catch {
        if (!alive) return;
        setMode('offline');
        setError(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, deps);
  const ready = mode !== 'stub' && mode !== '—' && mode !== 'offline';
  /** Après une réponse : le mode a pu changer (repli de fournisseur). */
  const refresh = () =>
    api
      .llmStatus()
      .then((s) => setMode((cur) => s.mode || cur))
      .catch(() => undefined);
  return { mode, error, ready, refresh };
}
