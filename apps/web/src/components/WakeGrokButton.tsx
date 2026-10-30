import { useState } from 'preact/hooks';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { Button, Spinner } from './ui';

type Props = {
  projectUuid: string;
  runUuid?: string;
  deploymentUuid?: string;
  variant?: 'primary' | 'outline' | 'ghost';
};

/** Un bouton : POST vers le webhook du bot Grok configuré, résultat affiché juste dessous. */
export function WakeGrokButton({ projectUuid, runUuid, deploymentUuid, variant = 'outline' }: Props) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);

  async function wake() {
    setBusy(true);
    setRes(null);
    try {
      const r = await api.wakeGrokBot({
        project_uuid: projectUuid,
        ...(runUuid ? { run_uuid: runUuid } : {}),
        ...(deploymentUuid ? { deployment_uuid: deploymentUuid } : {}),
      });
      setRes({ ok: r.data.ok, message: r.data.message });
    } catch (e) {
      setRes({ ok: false, message: String((e as Error).message || e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span class="inline-flex flex-col gap-1">
      <Button type="button" size="sm" variant={variant} disabled={busy} onClick={() => void wake()}>
        {busy ? <Spinner /> : null}
        Réveiller le bot Grok
      </Button>
      {res && (
        <span role="status" class={cn('text-xs', res.ok ? 'text-[var(--color-ok)]' : 'text-[var(--color-danger)]')}>
          {res.message}
          {!res.ok && /non configuré/i.test(res.message) && (
            <>
              {' '}
              <a class="underline" href="/app/settings">
                Réglages
              </a>
            </>
          )}
        </span>
      )}
    </span>
  );
}
