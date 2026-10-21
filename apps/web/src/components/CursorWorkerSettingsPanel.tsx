import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  Input,
  PulseDot,
  Skeleton,
  Switch,
  Table,
  Td,
  Tr,
  useToast,
} from './ui';

type WorkdirRow = {
  project_uuid: string;
  project_name: string;
  path: string;
  exists: boolean;
  has_git: boolean;
  git_remote?: string | null;
  eligible: boolean;
};

type Status = {
  ok: boolean;
  running: boolean;
  pid?: number | null;
  name: string;
  cli_installed: boolean;
  cli_path?: string | null;
  cli_version?: string | null;
  api_key_set: boolean;
  api_key_masked?: string | null;
  enabled: boolean;
  settings: {
    name: string;
    binary: string;
    extra_dirs: string;
    enabled: boolean;
  };
  workdirs: WorkdirRow[];
  eligible_count: number;
  eligible_paths: string[];
  registered_paths: string[];
  logs_tail: string;
  hint: string;
};

export function CursorWorkerSettingsPanel({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'start' | 'stop' | 'restart' | 'save' | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [name, setName] = useState('');
  const [binary, setBinary] = useState('');
  const [extraDirs, setExtraDirs] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const s = await api.cursorWorkerStatus();
      setStatus(s);
      setName(s.settings?.name || '');
      setBinary(s.settings?.binary || '');
      setExtraDirs(s.settings?.extra_dirs || '');
      setEnabled(!!s.enabled);
    } catch (e) {
      toast.push({ title: 'Cursor Worker', detail: String(e), tone: 'danger' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [isAdmin]);

  async function saveSettings(patch?: { enabled?: boolean }) {
    setBusy('save');
    try {
      const body: {
        enabled?: boolean;
        name?: string;
        binary?: string;
        extra_dirs?: string;
        api_key?: string;
      } = {
        enabled: patch?.enabled ?? enabled,
        name,
        binary,
        extra_dirs: extraDirs,
      };
      if (apiKey.trim()) body.api_key = apiKey.trim();
      const r = await api.cursorWorkerPatchSettings(body);
      setEnabled(!!r.enabled);
      setApiKey('');
      toast.push({ title: 'Réglages enregistrés', tone: 'ok' });
      await load();
    } catch (e) {
      toast.push({ title: 'Enregistrement KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }

  async function run(action: 'start' | 'stop' | 'restart') {
    setBusy(action);
    try {
      const r =
        action === 'start'
          ? await api.cursorWorkerStart()
          : action === 'stop'
            ? await api.cursorWorkerStop()
            : await api.cursorWorkerRestart();
      toast.push({
        title: action === 'stop' ? 'Worker arrêté' : 'Worker démarré',
        detail: r.message || undefined,
        tone: 'ok',
      });
      await load();
    } catch (e) {
      toast.push({ title: 'Action KO', detail: String(e), tone: 'danger' });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!isAdmin) {
    return <Alert tone="warn">Réservé à l’administrateur d’instance.</Alert>;
  }

  if (loading && !status) {
    return (
      <div class="space-y-4">
        <Skeleton class="h-28" />
        <Skeleton class="h-48" />
      </div>
    );
  }

  const running = !!status?.running;
  const eligible = status?.eligible_count ?? 0;

  return (
    <FadeIn class="space-y-6">
      <Card>
        <CardHeader
          title="Worker Cursor"
          description="Exécute les Cloud Agents / Grok Bot sur cette machine, avec tous les checkouts DevForge."
          action={
            <div class="flex items-center gap-2">
              <PulseDot tone={running ? 'ok' : 'muted'} />
              <Badge tone={running ? 'ok' : 'neutral'}>
                {running ? `En ligne · pid ${status?.pid ?? '?'}` : 'Arrêté'}
              </Badge>
            </div>
          }
        />
        <div class="space-y-3 text-sm text-[var(--color-ink-muted)]">
          <p>
            Machine annoncée :{' '}
            <strong class="text-[var(--color-ink)]">{status?.name || '…'}</strong>
            {status?.cli_installed ? (
              <>
                {' '}
                · CLI {status.cli_version || 'ok'}
                {status.cli_path ? (
                  <span class="ml-1 font-mono text-xs opacity-80">{status.cli_path}</span>
                ) : null}
              </>
            ) : (
              <> · CLI absente</>
            )}
            {' · '}
            {eligible} repo{eligible === 1 ? '' : 's'} éligible{eligible === 1 ? '' : 's'}
          </p>
          {status?.hint ? <Alert tone={running ? 'ok' : 'warn'}>{status.hint}</Alert> : null}
          <Alert tone="info">
            Le worker déplace l’exécution (fichiers, terminal) ici — la facturation des modèles reste
            celle de Cursor. Pour Grok Bot / Slack :{' '}
            <code class="text-xs">worker={status?.name || 'nom'}</code>.
          </Alert>
          <div class="flex flex-wrap gap-2 pt-1">
            <Button
              variant="primary"
              disabled={!!busy || running || !status?.cli_installed || !status?.api_key_set}
              onClick={() => void run('start')}
            >
              {busy === 'start' ? 'Démarrage…' : 'Démarrer'}
            </Button>
            <Button
              variant="secondary"
              disabled={!!busy || !running}
              onClick={() => void run('stop')}
            >
              {busy === 'stop' ? 'Arrêt…' : 'Arrêter'}
            </Button>
            <Button
              variant="secondary"
              disabled={!!busy || !status?.cli_installed || !status?.api_key_set}
              onClick={() => void run('restart')}
            >
              {busy === 'restart' ? 'Relance…' : 'Relancer (tous les repos)'}
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => void load()}>
              Actualiser
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Configuration"
          description="Clé API personnelle Cursor + nom My Machines. Un --worker-dir par projet Git."
        />
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="text-sm font-medium text-[var(--color-ink)]">Démarrage auto</div>
              <div class="text-xs text-[var(--color-ink-muted)]">
                Relance le worker au boot de DevForge (si CLI + clé OK).
              </div>
            </div>
            <Switch
              checked={enabled}
              label="Auto-start"
              onToggle={() => {
                const next = !enabled;
                setEnabled(next);
                void saveSettings({ enabled: next });
              }}
            />
          </div>
          <Input
            label="Nom de la machine"
            value={name}
            placeholder={status?.name || 'demeter'}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <Input
            label={`Clé API Cursor${status?.api_key_set ? ` (${status.api_key_masked})` : ' — manquante'}`}
            type="password"
            value={apiKey}
            placeholder={status?.api_key_set ? 'laisser vide pour conserver' : 'key_…'}
            onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
            autocomplete="off"
          />
          <Input
            label="Binaire agent (optionnel, sinon PATH)"
            value={binary}
            placeholder="/home/…/.local/bin/agent"
            onInput={(e) => setBinary((e.target as HTMLInputElement).value)}
          />
          <label class="flex min-w-0 w-full flex-col gap-1.5 text-sm">
            <span class="font-medium text-[var(--color-ink)]">
              Chemins extra (un par ligne) — hors projets DevForge
            </span>
            <textarea
              class="min-h-[88px] w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent-soft)]"
              value={extraDirs}
              placeholder="/home/user/code/autre-repo"
              onInput={(e) => setExtraDirs((e.target as HTMLTextAreaElement).value)}
            />
          </label>
          <Button variant="primary" disabled={!!busy} onClick={() => void saveSettings()}>
            {busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Repos Git enregistrés"
          description={`${eligible} éligible(s) · ${status?.workdirs?.length ?? 0} projet(s)`}
        />
        <Table headers={['Projet', 'État', 'Remote', 'Chemin']}>
          {(status?.workdirs ?? []).map((w) => (
            <Tr key={w.project_uuid}>
              <Td>{w.project_name}</Td>
              <Td>
                <Badge tone={w.eligible ? 'ok' : 'warn'}>
                  {w.eligible ? 'OK' : !w.exists ? 'absent' : 'pas de .git'}
                </Badge>
              </Td>
              <Td>
                <span class="break-all font-mono text-xs">{w.git_remote || '—'}</span>
              </Td>
              <Td>
                <span class="break-all font-mono text-xs opacity-80">{w.path}</span>
              </Td>
            </Tr>
          ))}
        </Table>
        {!status?.cli_installed ? (
          <Alert tone="warn" class="mt-4">
            Sur la machine hôte :{' '}
            <code class="text-xs">curl https://cursor.com/install -fsS | bash</code> puis
            actualise.
          </Alert>
        ) : null}
      </Card>

      {(status?.logs_tail || showLogs) && (
        <Card>
          <CardHeader
            title="Logs"
            action={
              <Button variant="ghost" onClick={() => setShowLogs((v) => !v)}>
                {showLogs ? 'Masquer' : 'Afficher'}
              </Button>
            }
          />
          {(showLogs || status?.logs_tail) && (
            <pre class="max-h-64 overflow-auto rounded-xl bg-[var(--color-surface)] p-3 font-mono text-xs whitespace-pre-wrap text-[var(--color-ink-muted)]">
              {status?.logs_tail || '(vide)'}
            </pre>
          )}
        </Card>
      )}
    </FadeIn>
  );
}
