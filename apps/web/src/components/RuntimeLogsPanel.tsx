import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Pause, Play, RefreshCw } from 'lucide-preact';
import { api } from '../lib/api';
import { Button, FadeIn, Spinner } from './ui';

const POLL_MS = 4000;
const TAIL = 300;

type Props = {
  projectUuid: string;
  /** UUID du dernier déploiement (lien vers ses journaux de build). */
  latestDeployUuid?: string | null;
};

/**
 * Logs live du conteneur en production (docker logs --tail).
 * Actualisation automatique toutes les 4 s, pause / manuel possibles.
 */
export function RuntimeLogsPanel({ projectUuid, latestDeployUuid }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [container, setContainer] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const stickBottom = useRef(true);
  const busy = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (busy.current) return;
    busy.current = true;
    if (!silent) setLoading(true);
    try {
      const r = await api.runtimeLogs(projectUuid, TAIL);
      const data = r.data ?? {};
      setContainer(typeof data.container === 'string' ? data.container : null);
      if (data.ok === false && data.error) {
        setError(data.error);
        setText(data.logs || null);
      } else {
        setError(null);
        setText(data.logs ?? '');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /404/.test(msg)
          ? 'Logs de l’app pas encore disponibles sur ce serveur.'
          : msg || 'Impossible de lire les logs.',
      );
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [projectUuid]);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => void load(true), POLL_MS);
    return () => window.clearInterval(id);
  }, [live, load]);

  useEffect(() => {
    if (stickBottom.current && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [text]);

  function onScroll() {
    const el = preRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  const empty = !loading && !error && (text === null || text.trim() === '');

  return (
    <FadeIn class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0 text-sm text-[var(--color-ink-muted)]">
          <span class="font-medium text-[var(--color-ink)]">Logs en live</span>
          {container ? (
            <span class="ml-2 font-mono text-xs text-[var(--color-ink-faint)]">{container}</span>
          ) : null}
          {live ? (
            <span class="ml-2 inline-flex items-center gap-1.5 text-xs text-[var(--color-ok)]">
              <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-ok)]" aria-hidden />
              Actualisation auto
            </span>
          ) : (
            <span class="ml-2 text-xs text-[var(--color-ink-faint)]">En pause</span>
          )}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          {latestDeployUuid ? (
            <Button
              size="sm"
              variant="ghost"
              href={`/app/projects/view?uuid=${encodeURIComponent(projectUuid)}&tab=deployments`}
            >
              Historique des mises en ligne
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setLive((v) => !v)}
            title={live ? 'Mettre en pause' : 'Reprendre l’actualisation'}
          >
            {live ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
            {live ? 'Pause' : 'Live'}
          </Button>
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => void load(false)}>
            {loading ? <Spinner /> : <RefreshCw size={14} aria-hidden />}
            Actualiser
          </Button>
        </div>
      </div>

      <div class="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-bg-elevated)]">
        {loading && text === null ? (
          <div class="flex h-64 items-center justify-center gap-2 text-sm text-[var(--color-ink-muted)]">
            <Spinner />
            Chargement des logs…
          </div>
        ) : error && !text ? (
          <p class="px-4 py-8 text-sm text-[var(--color-danger)]">{error}</p>
        ) : empty ? (
          <p class="px-4 py-8 text-sm text-[var(--color-ink-faint)]">
            Pas de logs : l’app n’a encore rien écrit.
          </p>
        ) : (
          <>
            {error ? (
              <p class="border-b border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-danger)]">
                {error}
              </p>
            ) : null}
            <pre
              ref={preRef}
              onScroll={onScroll}
              class="max-h-[min(70dvh,36rem)] overflow-auto p-4 font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)] whitespace-pre"
            >
              {(text ?? '').slice(-60_000)}
            </pre>
          </>
        )}
      </div>
    </FadeIn>
  );
}
