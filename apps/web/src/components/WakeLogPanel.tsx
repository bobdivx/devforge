import { useEffect, useState } from 'preact/hooks';
import { api, type WakeLogEntry } from '../lib/api';
import { cn } from '../lib/cn';

export type WakeLogClient = { wakeLog: (uuid: string, limit?: number) => Promise<{ data: WakeLogEntry[] }> };

const SOURCES: Record<string, string> = {
  routine: 'Routine',
  cron_agent: 'Cron agent',
  health: 'Santé',
  deploy_fail: 'Échec de déploiement',
  auto_deploy: 'Déploiement auto',
};

export function outcomeMeta(e: Pick<WakeLogEntry, 'outcome' | 'repeat'>): { label: string; tone: string } {
  switch (e.outcome) {
    case 'launched':
      return { label: 'Lancé', tone: 'bg-sky-500/15 text-sky-300' };
    case 'done':
      return { label: 'Terminé', tone: 'bg-emerald-500/15 text-emerald-300' };
    case 'failed':
      return { label: 'Échec', tone: 'bg-red-500/15 text-red-300' };
    case 'skipped':
      return { label: e.repeat > 1 ? `Ignoré ×${e.repeat}` : 'Ignoré', tone: 'bg-white/5 text-[var(--color-muted)]' };
    default:
      return { label: e.outcome, tone: 'bg-white/5 text-[var(--color-muted)]' };
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** P1-10 : historique compact des réveils automatiques (lancés, ignorés car état inchangé, échecs). */
export function WakeLogPanel({ projectUuid, client = api }: { projectUuid: string; client?: WakeLogClient }) {
  const [rows, setRows] = useState<WakeLogEntry[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    client
      .wakeLog(projectUuid, 30)
      .then((r) => alive && setRows(r.data ?? []))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [projectUuid]);

  return (
    <section class="mt-4 rounded-xl border border-[var(--color-line)] p-3" aria-labelledby="wake-log-title">
      <h3 id="wake-log-title" class="text-sm font-semibold">Historique des réveils</h3>
      <p class="mb-2 text-xs text-[var(--color-muted)]">
        Avant chaque réveil automatique, DevForge compare l'état du projet : s'il n'a pas changé, l'exécution est ignorée.
      </p>
      {error && <p class="text-xs text-red-300">Historique indisponible.</p>}
      {!error && rows === null && <p class="text-xs text-[var(--color-muted)]">Chargement…</p>}
      {rows !== null && rows.length === 0 && <p class="text-xs text-[var(--color-muted)]">Aucun réveil automatique pour l'instant.</p>}
      {rows !== null && rows.length > 0 && (
        <ul class="divide-y divide-[var(--color-line)]">
          {rows.map((r) => {
            const m = outcomeMeta(r);
            return (
              <li key={r.id} class="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-xs">
                <span class={cn('rounded-full px-2 py-0.5 font-medium', m.tone)}>{m.label}</span>
                <span class="font-medium">{SOURCES[r.source] ?? r.source}</span>
                <span class="min-w-0 flex-1 truncate text-[var(--color-muted)]" title={r.cause}>
                  {r.label ? `${r.label} · ` : ''}
                  {r.cause}
                </span>
                <code class="font-mono text-[10px] text-[var(--color-muted)]" title={`Empreinte ${r.state_hash}`}>
                  {r.state_hash.slice(0, 7)}
                </code>
                <time class="text-[var(--color-muted)]" dateTime={r.last_at}>
                  {when(r.last_at)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
