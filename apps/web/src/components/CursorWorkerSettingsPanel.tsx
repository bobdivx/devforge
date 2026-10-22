import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  api,
  type CursorWorkerInstallResult,
  type CursorWorkerNode,
  type CursorWorkerStatus,
} from '../lib/api';
import {
  Alert,
  Badge,
  Button,
  HubGrid,
  HubIcon,
  HubTile,
  Input,
  Modal,
  Skeleton,
  Spinner,
  Switch,
  useToast,
} from './ui';

type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';

const PILL: Record<Tone, string> = {
  ok: 'bg-emerald-500 text-zinc-950',
  warn: 'bg-amber-500 text-zinc-950',
  danger: 'bg-red-500 text-white',
  accent: 'bg-[var(--color-accent)] text-black',
  neutral: 'bg-white/20 text-white',
};

const TEXT: Record<Tone, string> = {
  ok: 'text-[var(--color-ok)]',
  warn: 'text-[var(--color-warn)]',
  danger: 'text-[var(--color-danger)]',
  accent: 'text-[var(--color-accent)]',
  neutral: 'text-[var(--color-ink-muted)]',
};

function pill(label: string, tone: Tone, detail?: string) {
  return {
    badge: (
      <span
        class={`absolute -right-1 -top-1 max-w-[4.5rem] truncate rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-2 ring-[#1c1c1e] ${PILL[tone]}`}
      >
        {label}
      </span>
    ),
    subtitle: detail ? (
      <div class={`mt-1 line-clamp-2 text-[11px] font-medium leading-snug ${TEXT[tone]}`}>
        {detail}
      </div>
    ) : undefined,
  };
}

/** État résumé du worker (tuile + bouton principal). Exporté pour les tests. */
export function workerSummary(
  s: Pick<
    CursorWorkerStatus,
    'running' | 'ready' | 'cli_installed' | 'api_key_set' | 'node_missing' | 'node_error'
  > & { key_invalid?: boolean; key_unsupported?: boolean; logged_in?: boolean },
): { label: string; tone: Tone; detail: string; installed: boolean } {
  if (s.node_missing) {
    return {
      label: 'Nœud ?',
      tone: 'danger',
      detail: 'Nœud introuvable',
      installed: false,
    };
  }
  if (s.node_error) {
    return {
      label: 'KO',
      tone: 'danger',
      detail: 'Nœud injoignable',
      installed: false,
    };
  }
  if (s.key_invalid) {
    return {
      label: 'Clé KO',
      tone: 'danger',
      detail: s.key_unsupported ? 'Clé grok_ refusée : se connecter' : 'Clé API refusée par Cursor',
      installed: false,
    };
  }
  if (s.running) {
    return s.ready === false
      ? {
          label: 'Connexion',
          tone: 'accent',
          detail: 'Connexion à Cursor…',
          installed: true,
        }
      : { label: 'ON', tone: 'ok', detail: 'Connecté', installed: true };
  }
  if ((!s.api_key_set && !s.logged_in) || !s.cli_installed) {
    return {
      label: 'À installer',
      tone: 'warn',
      detail: 'Un clic pour installer',
      installed: false,
    };
  }
  return { label: 'Off', tone: 'neutral', detail: 'Arrêté', installed: true };
}

/**
 * Champs obligatoires avant l’installation : la clé seulement si aucune n’est
 * enregistrée ou si Cursor a refusé la clé actuelle. Exporté pour les tests.
 */
export function installNeeds(
  s:
    | (Pick<CursorWorkerStatus, 'api_key_set'> & { key_invalid?: boolean; logged_in?: boolean })
    | null,
): Array<'api_key'> {
  if (!s || s.logged_in) return [];
  return !s.api_key_set || s.key_invalid ? ['api_key'] : [];
}

/** Avertissement non bloquant (clé probablement inutilisable par le worker). */
export function cursorKeyWarning(raw: string): string | null {
  return raw.trim().startsWith('grok_')
    ? 'Les clés grok_ ne sont pas encore acceptées par le worker Cursor (bug Cursor connu). Préfère « Se connecter avec Cursor ».'
    : null;
}

/**
 * Connexion Cursor sans clé (`cursor-agent login`) : DevForge donne le lien,
 * l’utilisateur valide dans son navigateur, la session est gardée sur le serveur.
 */
function CursorLogin({ loggedIn, onLoggedIn }: { loggedIn: boolean; onLoggedIn: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(loggedIn);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setDone(loggedIn), [loggedIn]);
  useEffect(() => {
    if (!url || done) return;
    const t = setInterval(async () => {
      try {
        const r = await api.cursorWorkerLoginStatus();
        if (r.logged_in) {
          setDone(true);
          setUrl(null);
          onLoggedIn();
        } else if (!r.pending) {
          setErr('La connexion a expiré : recommence.');
          setUrl(null);
        }
      } catch {
        /* réessaie au prochain tour */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [url, done]);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.cursorWorkerLoginStart();
      setUrl(r.url);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <Alert tone="ok">Connecté à Cursor : aucune clé nécessaire.</Alert>;
  }
  return (
    <div class="space-y-2 rounded-xl bg-[var(--color-surface)] p-3 ring-1 ring-[var(--color-line)]">
      <div class="text-sm font-medium text-[var(--color-ink)]">Se connecter avec Cursor</div>
      <p class="text-xs text-[var(--color-ink-muted)]">
        Recommandé : pas de clé à copier. Tu valides la connexion dans ton navigateur avec ton
        compte Cursor ; la clé enregistrée est alors remplacée.
      </p>
      {url ? (
        <div class="space-y-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-11 w-full items-center justify-center rounded-xl bg-[var(--color-accent)] px-4 text-sm font-medium text-zinc-950 sm:w-auto"
          >
            Ouvrir la connexion Cursor
          </a>
          <div class="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
            <Spinner /> En attente de la validation dans le navigateur…
          </div>
        </div>
      ) : (
        <Button variant="secondary" disabled={busy} onClick={() => void start()}>
          {busy ? 'Préparation…' : 'Se connecter avec Cursor'}
        </Button>
      )}
      {err ? <p class="text-xs text-[var(--color-danger)]">{err}</p> : null}
    </div>
  );
}

const FOREIGN_KEYS: Array<[string, string]> = [
  ['xai-', 'xAI'],
  ['sk-ant-', 'Anthropic'],
  ['sk-or-', 'OpenRouter'],
  ['sk-', 'OpenAI'],
  ['gsk_', 'Groq'],
  ['AIza', 'Google'],
  ['ghp_', 'GitHub'],
  ['gho_', 'GitHub'],
  ['github_pat_', 'GitHub'],
  ['hf_', 'Hugging Face'],
];

/** Problème évident d’une clé saisie (vide = pas de problème). Exporté pour les tests. */
export function cursorKeyProblem(raw: string): string | null {
  const k = raw.trim();
  if (!k) return null;
  const foreign = FOREIGN_KEYS.find(([p]) => k.startsWith(p));
  if (foreign) {
    return `Ceci est une clé ${foreign[1]}, pas une clé Cursor. Crée-la sur cursor.com/dashboard → API Keys.`;
  }
  if (/\s/.test(k)) return 'La clé ne doit pas contenir d’espace.';
  if (k.length < 16)
    return 'Clé trop courte : copie la clé complète depuis cursor.com/dashboard → API Keys.';
  return null;
}

const KEY_HINT =
  'Clé Cursor personnelle : cursor.com/dashboard → API Keys (pas une clé xAI / OpenAI).';

/** Champ masqué unique pour la clé : une saisie remplace la clé stockée, vide = conserver. */
function KeyField({
  status,
  value,
  onInput,
  required,
}: {
  status: CursorWorkerStatus;
  value: string;
  onInput: (v: string) => void;
  required: boolean;
}) {
  const problem = cursorKeyProblem(value);
  const warning = problem ? null : cursorKeyWarning(value);
  const placeholder =
    status.api_key_set && !required
      ? `${status.api_key_masked ?? '••••'} — laisser vide pour conserver`
      : 'key_…';
  return (
    <div class="space-y-1.5">
      <Input
        label="Clé API Cursor"
        type="password"
        name="cursor-api-key"
        value={value}
        placeholder={placeholder}
        autocomplete="new-password"
        spellcheck={false}
        hint={problem ? undefined : KEY_HINT}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      />
      {problem ? <p class="text-xs text-[var(--color-danger)]">{problem}</p> : null}
      {warning ? <p class="text-xs text-[var(--color-warn)]">{warning}</p> : null}
      {status.env_key_present ? (
        <p class="text-xs text-[var(--color-ink-muted)]">
          {status.api_key_source === 'env'
            ? 'La clé actuelle vient de la variable CURSOR_API_KEY du serveur ; en saisir une ici la remplace.'
            : 'Une variable CURSOR_API_KEY existe aussi sur le serveur : la clé enregistrée ici est prioritaire.'}
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ComponentChildren }) {
  return (
    <div class="flex items-start justify-between gap-3 border-b border-[var(--color-line)] py-2 text-sm last:border-0">
      <span class="shrink-0 text-[var(--color-ink-muted)]">{label}</span>
      <span class="min-w-0 break-words text-right text-[var(--color-ink)] [overflow-wrap:anywhere]">
        {value}
      </span>
    </div>
  );
}

const SELECT_CLASS =
  'h-11 w-full min-w-0 cursor-pointer rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-ink)] outline-none transition-[border-color,box-shadow] duration-200 focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent-soft)] sm:text-sm lg:h-10';

type ModalKind = 'install' | 'status' | 'repos' | 'advanced' | null;

/**
 * Admin « Worker Cursor » : un bouton principal installe tout (CLI, démarrage,
 * vérification) ; seule la clé API Cursor est demandée si elle manque.
 * Tuiles = statut (+ un switch) ; détails et réglages dans des modales.
 */
export function CursorWorkerSettingsPanel({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const [status, setStatus] = useState<CursorWorkerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setStatus(await api.cursorWorkerStatus());
      setError(null);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [isAdmin]);

  if (!isAdmin) return <Alert tone="warn">Réservé à l’administrateur d’instance.</Alert>;
  if (!status) {
    return error ? (
      <Alert tone="danger">{error}</Alert>
    ) : (
      <div class="space-y-4">
        <Skeleton class="h-12" />
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Skeleton class="h-36" />
          <Skeleton class="h-36" />
          <Skeleton class="h-36" />
        </div>
      </div>
    );
  }

  const sum = workerSummary(status);
  const st = pill(
    sum.label,
    sum.tone,
    sum.installed ? `${status.node?.name ?? status.name} · ${sum.detail}` : sum.detail,
  );
  const repos =
    status.eligible_count == null
      ? pill('Auto', 'neutral', 'Comptés au démarrage')
      : pill(
          String(status.eligible_count),
          status.eligible_count > 0 ? 'ok' : 'warn',
          status.eligible_count > 0 ? 'dépôt(s) servis' : 'Aucun dépôt cloné',
        );
  const adv = status.key_invalid
    ? pill('Clé', 'danger', 'Clé API refusée : la remplacer')
    : pill('Auto', 'neutral', 'Clé API, nom, dossiers');

  async function toggleAuto() {
    setBusy(true);
    try {
      await api.cursorWorkerPatchSettings({ enabled: !status!.enabled });
      toast.push({
        title: status!.enabled ? 'Démarrage auto désactivé' : 'Démarrage auto activé',
        tone: 'ok',
      });
      await load();
    } catch (e) {
      toast.push({
        title: 'Échec',
        detail: String((e as Error).message || e),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="space-y-4">
      <div class="flex flex-col gap-3 rounded-2xl bg-[#1c1c1e] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0">
          <div class="text-sm font-medium text-[var(--color-ink)]">
            {sum.installed ? 'Worker Cursor installé' : 'Worker Cursor'}
          </div>
          <p class="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            {sum.installed
              ? 'Les agents Cursor / Grok Bot peuvent travailler sur tes dépôts DevForge.'
              : 'DevForge installe, démarre et vérifie le worker pour toi.'}
          </p>
        </div>
        <Button
          variant="primary"
          size="lg"
          class="w-full sm:w-auto"
          disabled={busy}
          onClick={() => setModal('install')}
        >
          {sum.installed ? 'Réinstaller le worker Cursor' : 'Installer le worker Cursor'}
        </Button>
      </div>

      <HubGrid cols={3}>
        <HubTile
          index={0}
          title="Worker"
          icon={<HubIcon name="cpu" />}
          badge={st.badge}
          subtitle={st.subtitle}
          onClick={() => setModal('status')}
          footer={
            <Switch
              checked={status.enabled}
              disabled={busy}
              label="Démarrage auto"
              onToggle={() => void toggleAuto()}
            />
          }
        />
        <HubTile
          index={1}
          title="Dépôts"
          icon={<HubIcon name="folder" />}
          badge={repos.badge}
          subtitle={repos.subtitle}
          onClick={() => setModal('repos')}
        />
        <HubTile
          index={2}
          title="Avancé"
          icon={<HubIcon name="settings" />}
          badge={adv.badge}
          subtitle={adv.subtitle}
          onClick={() => setModal('advanced')}
        />
      </HubGrid>

      <InstallModal
        open={modal === 'install'}
        status={status}
        onClose={() => setModal(null)}
        onDone={() => void load()}
      />
      <StatusModal
        open={modal === 'status'}
        status={status}
        onClose={() => setModal(null)}
        onChanged={() => void load()}
      />
      <ReposModal open={modal === 'repos'} status={status} onClose={() => setModal(null)} />
      <AdvancedModal
        open={modal === 'advanced'}
        status={status}
        onClose={() => setModal(null)}
        onSaved={() => {
          setModal(null);
          void load();
        }}
      />
    </div>
  );
}

function nodeLabel(n: CursorWorkerNode) {
  return `${n.name}${n.leader ? ' (ce serveur)' : ''}${n.online ? '' : ' — hors ligne'}`;
}

function InstallModal({
  open,
  status,
  onClose,
  onDone,
}: {
  open: boolean;
  status: CursorWorkerStatus;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const nodes = status.nodes ?? [];
  const [apiKey, setApiKey] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [showNode, setShowNode] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CursorWorkerInstallResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const needs = installNeeds(status);
  const keyProblem = cursorKeyProblem(apiKey);
  const retryKey = !!result && !result.ok && !!result.key_invalid;

  useEffect(() => {
    if (!open) return;
    setApiKey('');
    setNodeId(status.node?.id ?? '');
    setShowNode(false);
    setResult(null);
    setErr(null);
  }, [open]);

  const node = nodes.find((n) => n.id === nodeId) ?? nodes.find((n) => n.leader);
  const canRun =
    !running &&
    !keyProblem &&
    (!(needs.includes('api_key') || retryKey) || apiKey.trim().length > 0) &&
    node?.online !== false;

  async function run() {
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.cursorWorkerInstall({
        node_id: nodeId,
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      });
      setResult(r);
      setApiKey('');
      toast.push({
        title: r.ok ? 'Worker Cursor prêt' : 'Installation incomplète',
        detail: r.message,
        tone: r.ok ? 'ok' : 'danger',
      });
      onDone();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !running && onClose()}
      title="Installer le worker Cursor"
      description={result ? undefined : 'Installation, démarrage et vérification automatiques.'}
      size="md"
      fullOnMobile
      footer={
        <div class="flex flex-wrap justify-end gap-2">
          {result && retryKey ? (
            <>
              <Button variant="ghost" disabled={running} onClick={onClose}>
                Fermer
              </Button>
              <Button variant="primary" disabled={!canRun} onClick={() => void run()}>
                {running ? 'Installation…' : 'Réessayer avec cette clé'}
              </Button>
            </>
          ) : result ? (
            <Button variant="primary" onClick={onClose}>
              Fermer
            </Button>
          ) : (
            <>
              <Button variant="ghost" disabled={running} onClick={onClose}>
                Annuler
              </Button>
              <Button variant="primary" disabled={!canRun} onClick={() => void run()}>
                {running ? 'Installation…' : 'Confirmer et installer'}
              </Button>
            </>
          )}
        </div>
      }
    >
      {result ? (
        <div class="space-y-3">
          <Alert tone={result.ok ? 'ok' : 'danger'}>{result.message}</Alert>
          <ol class="space-y-2">
            {result.steps.map((s) => (
              <li
                key={s.id}
                class="rounded-xl bg-[var(--color-surface)] p-3 ring-1 ring-[var(--color-line)]"
              >
                <div class="flex items-center justify-between gap-2 text-sm">
                  <span class="font-medium text-[var(--color-ink)]">{s.label}</span>
                  <Badge tone={s.ok ? 'ok' : 'danger'}>{s.ok ? 'OK' : 'Échec'}</Badge>
                </div>
                {s.detail ? (
                  <pre class="mt-1 whitespace-pre-wrap break-words font-sans text-xs text-[var(--color-ink-muted)]">
                    {s.detail}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
          {retryKey ? (
            <KeyField status={status} value={apiKey} onInput={setApiKey} required />
          ) : null}
          {result.ok ? (
            <p class="text-xs text-[var(--color-ink-muted)]">
              Dans Cursor (My Machines) ou Grok Bot, choisis la machine{' '}
              <code class="text-xs">{result.name}</code>.
            </p>
          ) : null}
        </div>
      ) : running ? (
        <div class="flex items-center gap-2 py-6 text-sm text-[var(--color-ink-muted)]">
          <Spinner /> Installation du CLI, démarrage et vérification sur {node?.name}… (jusqu’à 2
          min)
        </div>
      ) : (
        <div class="space-y-4">
          <div class="rounded-xl bg-[var(--color-surface)] px-3 ring-1 ring-[var(--color-line)]">
            <Row
              label="Machine"
              value={
                <span class="inline-flex items-center gap-2">
                  {node ? nodeLabel(node) : '—'}
                  {nodes.length > 1 ? (
                    <button
                      type="button"
                      class="text-xs text-[var(--color-accent)] underline-offset-2 hover:underline"
                      onClick={() => setShowNode((v) => !v)}
                    >
                      Changer
                    </button>
                  ) : null}
                </span>
              }
            />
            <Row label="Nom annoncé" value={status.name} />
            <Row
              label="Dépôts"
              value={
                status.eligible_count == null || status.node?.id !== nodeId
                  ? 'Tous les dépôts clonés du nœud'
                  : `${status.eligible_count} dépôt(s)`
              }
            />
            <Row
              label="CLI Cursor"
              value={
                status.cli_installed && status.node?.id === nodeId
                  ? `Déjà installé ${status.cli_version ?? ''}`
                  : 'Installé automatiquement'
              }
            />
            <Row
              label="Clé API"
              value={
                status.key_invalid
                  ? 'Refusée par Cursor — à remplacer'
                  : status.logged_in
                    ? 'Connexion Cursor (sans clé)'
                    : status.api_key_set
                      ? `${status.api_key_masked ?? 'enregistrée'}${status.api_key_source === 'env' ? ' (serveur)' : ''}`
                      : 'À fournir ci-dessous'
              }
            />
          </div>
          {showNode && nodes.length > 1 ? (
            <label class="flex flex-col gap-1.5 text-sm">
              <span class="font-medium text-[var(--color-ink)]">Machine qui exécute le worker</span>
              <select
                class={SELECT_CLASS}
                value={nodeId}
                onChange={(e) => setNodeId((e.target as HTMLSelectElement).value)}
              >
                {nodes.map((n) => (
                  <option key={n.id || 'leader'} value={n.id} disabled={!n.online}>
                    {nodeLabel(n)}
                  </option>
                ))}
              </select>
              <span class="text-xs text-[var(--color-ink-muted)]">
                Le worker sert les dépôts clonés sur cette machine. L’ancien worker est arrêté.
              </span>
            </label>
          ) : null}
          {status.key_invalid ? (
            <Alert tone="danger">
              {status.key_unsupported
                ? `Cursor a refusé la clé grok_ (${status.api_key_masked}) : le worker ne les accepte pas encore. Connecte-toi avec Cursor ci-dessous.`
                : `Cursor a refusé la clé enregistrée (${status.api_key_masked}). Connecte-toi avec Cursor ou colle une autre clé.`}
            </Alert>
          ) : null}
          {node?.leader !== false ? (
            <CursorLogin
              loggedIn={!!status.logged_in}
              onLoggedIn={() => {
                setApiKey('');
                onDone();
              }}
            />
          ) : null}
          {status.logged_in ? null : (
            <div class="text-center text-xs text-[var(--color-ink-muted)]">ou</div>
          )}
          {status.logged_in ? null : (
            <KeyField
              status={status}
              value={apiKey}
              onInput={setApiKey}
              required={needs.includes('api_key')}
            />
          )}
          {err ? <Alert tone="danger">{err}</Alert> : null}
          <p class="text-xs text-[var(--color-ink-muted)]">
            Le worker exécute les agents Cursor sur cette machine (fichiers, terminal). La
            facturation des modèles reste celle de Cursor. S’il tourne déjà, il est relancé.
          </p>
        </div>
      )}
    </Modal>
  );
}

function StatusModal({
  open,
  status,
  onClose,
  onChanged,
}: {
  open: boolean;
  status: CursorWorkerStatus;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<'restart' | 'stop' | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmStop(false);
      setShowLogs(false);
    }
  }, [open]);

  async function act(kind: 'restart' | 'stop') {
    setBusy(kind);
    try {
      const r = kind === 'stop' ? await api.cursorWorkerStop() : await api.cursorWorkerRestart();
      toast.push({
        title: kind === 'stop' ? 'Worker arrêté' : 'Worker relancé',
        detail: r.message || undefined,
        tone: 'ok',
      });
      setConfirmStop(false);
      onChanged();
    } catch (e) {
      toast.push({
        title: 'Échec',
        detail: String((e as Error).message || e),
        tone: 'danger',
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  const sum = workerSummary(status);
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={confirmStop ? 'Arrêter le worker ?' : 'Worker Cursor'}
      size="md"
      fullOnMobile
      footer={
        <div class="flex flex-wrap justify-end gap-2">
          {confirmStop ? (
            <>
              <Button variant="ghost" disabled={!!busy} onClick={() => setConfirmStop(false)}>
                Retour
              </Button>
              <Button variant="danger" disabled={!!busy} onClick={() => void act('stop')}>
                {busy === 'stop' ? 'Arrêt…' : 'Arrêter'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                disabled={!!busy || !status.running}
                onClick={() => setConfirmStop(true)}
              >
                Arrêter…
              </Button>
              <Button
                variant="secondary"
                disabled={!!busy || !status.cli_installed || (!status.api_key_set && !status.logged_in)}
                onClick={() => void act('restart')}
              >
                {busy === 'restart' ? 'Relance…' : status.running ? 'Relancer' : 'Démarrer'}
              </Button>
            </>
          )}
        </div>
      }
    >
      {confirmStop ? (
        <p class="text-sm text-[var(--color-ink-muted)]">
          Les agents Cursor ne pourront plus utiliser <strong>{status.name}</strong> jusqu’au
          prochain démarrage. Les dépôts ne sont pas touchés.
        </p>
      ) : (
        <div class="space-y-3">
          <Alert tone={sum.tone === 'ok' ? 'ok' : sum.tone === 'danger' ? 'danger' : 'info'}>
            {status.node_error || status.hint}
          </Alert>
          <div>
            <Row label="État" value={`${sum.label}${status.pid ? ` · pid ${status.pid}` : ''}`} />
            <Row label="Machine" value={status.node ? nodeLabel(status.node) : '—'} />
            <Row label="Nom annoncé" value={<code class="text-xs">{status.name}</code>} />
            {status.running && status.repos_up != null ? (
              <Row
                label="Dépôts actifs"
                value={`${status.repos_up}${
                  status.registered_paths?.length ? ` / ${status.registered_paths.length}` : ''
                } (un process par dépôt)`}
              />
            ) : null}
            <Row
              label="CLI Cursor"
              value={status.cli_installed ? status.cli_version || 'installé' : 'non installé'}
            />
            <Row
              label="Clé API"
              value={
                status.api_key_set
                  ? status.api_key_masked || 'enregistrée'
                  : status.logged_in
                    ? 'Connexion Cursor (sans clé)'
                    : 'manquante'
              }
            />
            <Row label="Démarrage auto" value={status.enabled ? 'Oui' : 'Non'} />
          </div>
          {status.logs_tail ? (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setShowLogs((v) => !v)}>
                {showLogs ? 'Masquer les logs' : 'Voir les logs'}
              </Button>
              {showLogs ? (
                <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-ink-muted)]">
                  {status.logs_tail}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function ReposModal({
  open,
  status,
  onClose,
}: {
  open: boolean;
  status: CursorWorkerStatus;
  onClose: () => void;
}) {
  const rows = status.workdirs ?? [];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Dépôts servis"
      description="Chaque projet DevForge cloné (avec .git) est exposé au worker."
      size="lg"
      fullOnMobile
    >
      {status.eligible_count == null ? (
        <Alert tone="info">
          Sur {status.node?.name ?? 'ce nœud'}, les dépôts clonés sont détectés à chaque démarrage.
        </Alert>
      ) : rows.length === 0 ? (
        <Alert tone="info">Aucun projet pour l’instant.</Alert>
      ) : (
        <ul class="divide-y divide-[var(--color-line)]">
          {rows.map((w) => (
            <li key={w.project_uuid} class="flex items-start justify-between gap-3 py-2">
              <div class="min-w-0">
                <div class="truncate text-sm text-[var(--color-ink)]">{w.project_name}</div>
                <div class="break-all font-mono text-[11px] text-[var(--color-ink-muted)]">
                  {w.git_remote || w.path}
                </div>
              </div>
              <Badge tone={w.eligible ? 'ok' : 'neutral'}>
                {w.eligible ? 'Servi' : !w.exists ? 'Pas cloné' : 'Sans .git'}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function AdvancedModal({
  open,
  status,
  onClose,
  onSaved,
}: {
  open: boolean;
  status: CursorWorkerStatus;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [binary, setBinary] = useState('');
  const [extraDirs, setExtraDirs] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setName(status.settings?.name || '');
    setBinary(status.settings?.binary || '');
    setExtraDirs(status.settings?.extra_dirs || '');
    setApiKey('');
  }, [open]);

  async function deleteKey() {
    setBusy(true);
    try {
      await api.cursorWorkerPatchSettings({ api_key: '' });
      toast.push({ title: 'Clé API supprimée', tone: 'ok' });
      onSaved();
    } catch (e) {
      toast.push({
        title: 'Échec',
        detail: String((e as Error).message || e),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (cursorKeyProblem(apiKey)) return;
    setBusy(true);
    try {
      await api.cursorWorkerPatchSettings({
        name,
        binary,
        extra_dirs: extraDirs,
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      });
      toast.push({
        title: 'Réglages enregistrés',
        detail: apiKey.trim()
          ? 'Clé remplacée. Clique « Réinstaller le worker Cursor » pour l’utiliser.'
          : status.running
            ? 'Relance le worker pour les appliquer.'
            : undefined,
        tone: 'ok',
      });
      onSaved();
    } catch (e) {
      toast.push({
        title: 'Échec',
        detail: String((e as Error).message || e),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Avancé"
      description="Facultatif : tout est déjà déduit automatiquement."
      size="md"
      fullOnMobile
      footer={
        confirmDelete ? (
          <div class="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>
              Retour
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void deleteKey()}>
              {busy ? 'Suppression…' : 'Supprimer la clé'}
            </Button>
          </div>
        ) : (
          <div class="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Annuler
            </Button>
            <Button
              variant="primary"
              disabled={busy || !!cursorKeyProblem(apiKey)}
              onClick={() => void save()}
            >
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        )
      }
    >
      {confirmDelete ? (
        <p class="text-sm text-[var(--color-ink-muted)]">
          La clé {status.api_key_masked} sera effacée de DevForge. Le worker ne pourra plus démarrer
          tant qu’une nouvelle clé n’est pas saisie.
        </p>
      ) : (
        <div class="space-y-4">
          <Input
            label="Nom de la machine"
            value={name}
            placeholder={`${status.name} (auto)`}
            hint="Vide = nom du nœud."
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <KeyField status={status} value={apiKey} onInput={setApiKey} required={false} />
          {status.api_key_set && status.api_key_source === 'settings' ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              Supprimer la clé enregistrée…
            </Button>
          ) : null}
          <Input
            label="Chemin du binaire agent"
            value={binary}
            placeholder={status.cli_path ? `${status.cli_path} (auto)` : 'auto'}
            hint="Vide = installé et trouvé automatiquement."
            onInput={(e) => setBinary((e.target as HTMLInputElement).value)}
          />
          <label class="flex min-w-0 w-full flex-col gap-1.5 text-sm">
            <span class="font-medium text-[var(--color-ink)]">Dossiers en plus (un par ligne)</span>
            <textarea
              class="min-h-[88px] w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 font-mono text-base text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent-soft)] sm:text-sm"
              value={extraDirs}
              placeholder="/chemin/vers/autre-depot"
              onInput={(e) => setExtraDirs((e.target as HTMLTextAreaElement).value)}
            />
            <span class="text-xs text-[var(--color-ink-muted)]">
              Dépôts Git hors projets DevForge. Vide = uniquement les projets.
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
}
