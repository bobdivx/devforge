import { useEffect, useMemo, useState } from 'preact/hooks';
import { shortSha } from '../lib/deployStatus';
import { GitBranch, FlaskConical, ExternalLink, Search } from 'lucide-preact';
import { api, type Deployment, type ProjectBranches } from '../lib/api';
import { cn } from '../lib/cn';
import { Alert, Badge, Button, Card, HubGrid, HubTile, Modal, Spinner, Switch, useToast } from './ui';

/** Déploiement de l’environnement dev ? (sinon prod). */
export function isDevDeployment(d: Pick<Deployment, 'environment'>): boolean {
  return (d.environment || '').toLowerCase() === 'dev';
}

/** Pastille Prod / DEV pour les listes de déploiements. */
export function EnvBadge({ deployment }: { deployment: Pick<Deployment, 'environment'> }) {
  return isDevDeployment(deployment) ? (
    <Badge tone="warn" class="!px-1.5 !py-0 text-[10px] font-semibold uppercase tracking-wide">
      Dev
    </Badge>
  ) : (
    <Badge tone="neutral" class="!px-1.5 !py-0 text-[10px] uppercase tracking-wide">
      Prod
    </Badge>
  );
}

function parseOwnerRepo(url?: string | null): { owner: string; repo: string } | null {
  const m = (url || '').trim().match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

const STATUS_WORD: Record<string, string> = {
  success: 'en ligne',
  failed: 'échec',
  error: 'échec',
  cancelled: 'annulé',
  queued: 'en file',
  running: 'déploiement…',
  building: 'build…',
};

function statusTone(s?: string | null): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (!s) return 'neutral';
  if (s === 'success') return 'ok';
  if (s === 'failed' || s === 'error') return 'danger';
  if (['queued', 'running', 'building', 'pending', 'deploying'].includes(s)) return 'warn';
  return 'neutral';
}

/** Liste de branches GitHub avec recherche (mobile : grandes cibles tactiles). */
function BranchPicker({
  branches,
  loading,
  value,
  onChange,
  exclude,
}: {
  branches: string[];
  loading: boolean;
  value: string;
  onChange: (b: string) => void;
  exclude?: string | null;
}) {
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branches
      .filter((b) => b !== exclude)
      .filter((b) => !q || b.toLowerCase().includes(q));
  }, [branches, query, exclude]);
  const typed = query.trim();
  const canUseTyped = typed && !branches.includes(typed) && typed !== exclude;
  return (
    <div class="space-y-2">
      <label class="relative block">
        <Search size={14} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" aria-hidden />
        <input
          type="search"
          value={query}
          placeholder="Rechercher une branche"
          aria-label="Rechercher une branche"
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          class="h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] pl-9 pr-3 text-sm lg:h-10"
        />
      </label>
      <div class="max-h-64 overflow-y-auto rounded-xl border border-[var(--color-line)]" role="listbox" aria-label="Branches">
        {loading && (
          <div class="flex items-center gap-2 px-3 py-3 text-sm text-[var(--color-ink-muted)]">
            <Spinner /> Chargement des branches GitHub…
          </div>
        )}
        {!loading && list.length === 0 && !canUseTyped && (
          <p class="px-3 py-3 text-sm text-[var(--color-ink-muted)]">Aucune branche trouvée.</p>
        )}
        {list.map((b) => (
          <button
            key={b}
            type="button"
            role="option"
            aria-selected={b === value}
            onClick={() => onChange(b)}
            class={cn(
              'flex min-h-[44px] w-full items-center gap-2 border-b border-[var(--color-line)] px-3 text-left text-sm last:border-b-0',
              b === value ? 'bg-[var(--color-accent-soft)] text-white' : 'hover:bg-white/5',
            )}
          >
            <GitBranch size={14} class="shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
            <span class="min-w-0 flex-1 truncate font-mono text-[13px]">{b}</span>
            {b === value && <span class="text-xs text-[var(--color-accent)]">choisie</span>}
          </button>
        ))}
        {canUseTyped && (
          <button
            type="button"
            onClick={() => onChange(typed)}
            class="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm hover:bg-white/5"
          >
            Utiliser « <span class="font-mono">{typed}</span> »
          </button>
        )}
      </div>
    </div>
  );
}

type Step = null | 'prod' | 'prod-confirm' | 'dev' | 'dev-confirm' | 'dev-off' | 'dev-redeploy';

/**
 * Paramètres → Branches : branche de production + environnement dev optionnel
 * (`dev-app.zone` ou `dev.example.com`).
 */
export function ProjectBranchesPanel({
  projectUuid,
  repository,
  onChanged,
}: {
  projectUuid: string;
  repository?: string | null;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<ProjectBranches | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [step, setStep] = useState<Step>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await api.projectBranches(projectUuid);
      setData(r.data);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void load();
  }, [projectUuid]);

  // Rafraîchit tant qu’un déploiement dev tourne.
  const devStatus = data?.dev.last_deployment?.status;
  useEffect(() => {
    if (statusTone(devStatus) !== 'warn') return;
    const t = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(t);
  }, [devStatus, projectUuid]);

  useEffect(() => {
    const parsed = parseOwnerRepo(repository);
    if (!parsed) return;
    let cancelled = false;
    setBranchesLoading(true);
    api
      .githubBranches(parsed.owner, parsed.repo)
      .then((r) => {
        if (!cancelled) setBranches(r.data.map((b) => b.name));
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  if (error && !data) {
    return <Alert tone="danger">Branches indisponibles : {error}</Alert>;
  }
  if (!data) {
    return (
      <div class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
        <Spinner /> Chargement…
      </div>
    );
  }

  const prod = data.production.branch || 'main';
  const dev = data.dev;
  const last = dev.last_deployment;
  const devUrlLabel = (dev.url || '').replace(/^https?:\/\//, '');

  function open(next: Step) {
    if (next === 'prod') setPick(prod);
    if (next === 'dev') setPick(dev.branch || branches.find((b) => b !== prod && /^(dev|develop|staging)$/.test(b)) || '');
    setStep(next);
  }

  async function applyProd(redeploy: boolean) {
    setBusy(true);
    try {
      const r = await api.setProductionBranch(projectUuid, pick, redeploy);
      setData(r.data);
      toast.push({
        title: 'Branche de production changée',
        detail: redeploy ? `${pick} · redéploiement lancé` : `${pick} · appliquée au prochain déploiement`,
        tone: 'ok',
      });
      setStep(null);
      onChanged?.();
    } catch (e) {
      toast.push({ title: 'Changement KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function applyDev(deploy: boolean) {
    setBusy(true);
    try {
      const r = await api.setDevBranch(projectUuid, pick, deploy);
      setData(r.data);
      toast.push({
        title: dev.enabled ? 'Branche dev changée' : 'Environnement dev activé',
        detail: deploy ? `${pick} · déploiement DEV lancé` : `${pick} · pas encore déployée`,
        tone: 'ok',
      });
      setStep(null);
      onChanged?.();
    } catch (e) {
      toast.push({ title: 'Dev KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function disableDev() {
    setBusy(true);
    try {
      const r = await api.disableDevBranch(projectUuid);
      setData(r.data);
      toast.push({ title: 'Environnement dev supprimé', detail: 'Conteneur et route dev retirés', tone: 'ok' });
      setStep(null);
      onChanged?.();
    } catch (e) {
      toast.push({ title: 'Désactivation KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function redeployDev() {
    setBusy(true);
    try {
      await api.deployDev(projectUuid);
      toast.push({ title: 'Déploiement DEV lancé', detail: dev.branch || '', tone: 'info' });
      setStep(null);
      await load();
      onChanged?.();
    } catch (e) {
      toast.push({ title: 'Déploiement DEV KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  const devSubtitle = dev.enabled ? (
    <div class="mt-1 flex min-w-0 flex-col items-center gap-1">
      <span class="max-w-full truncate font-mono text-[11px] text-[var(--color-ink-muted)]">{dev.branch}</span>
      <Badge tone={statusTone(last?.status)} class="!py-0 text-[10px]">
        DEV · {last ? STATUS_WORD[last.status] || last.status : 'jamais déployée'}
      </Badge>
    </div>
  ) : (
    <div class="mt-1 text-[11px] text-[var(--color-ink-muted)]">
      {dev.unsupported_reason ? 'Indisponible' : 'Désactivée'}
    </div>
  );

  return (
    <div class="space-y-4">
      <HubGrid cols={3}>
        <HubTile
          index={0}
          title="Production"
          icon={<GitBranch size={22} aria-hidden />}
          subtitle={
            <div class="mt-1 flex min-w-0 flex-col items-center gap-1">
              <span class="max-w-full truncate font-mono text-[11px] text-[var(--color-ink-muted)]">{prod}</span>
              <Badge tone="ok" class="!py-0 text-[10px]">Prod</Badge>
            </div>
          }
          onClick={() => open('prod')}
        />
        <HubTile
          index={1}
          title="Dev"
          icon={<FlaskConical size={22} aria-hidden />}
          subtitle={devSubtitle}
          onClick={() => (dev.unsupported_reason ? undefined : open('dev'))}
          footer={
            <Switch
              checked={dev.enabled}
              disabled={busy || (!dev.enabled && Boolean(dev.unsupported_reason))}
              label="Environnement dev"
              onToggle={() => open(dev.enabled ? 'dev-off' : 'dev')}
            />
          }
        />
      </HubGrid>

      {dev.unsupported_reason && !dev.enabled && <Alert tone="warn">{dev.unsupported_reason}</Alert>}

      {dev.enabled && (
        <Card>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <Badge tone="warn" class="font-semibold uppercase tracking-wide">Dev</Badge>
                <span class="font-mono text-sm text-white">{dev.branch}</span>
                {last && (
                  <Badge tone={statusTone(last.status)}>
                    {STATUS_WORD[last.status] || last.status}
                    {shortSha(last.git_sha) ? ` · ${shortSha(last.git_sha)}` : ''}
                  </Badge>
                )}
              </div>
              {dev.url && (
                <a
                  href={dev.url}
                  target="_blank"
                  rel="noreferrer"
                  class="inline-flex max-w-full items-center gap-1 text-sm text-[var(--color-accent)] hover:underline [overflow-wrap:anywhere]"
                >
                  {devUrlLabel} <ExternalLink size={12} aria-hidden />
                </a>
              )}
            </div>
            <Button size="sm" variant="secondary" class="max-lg:h-11" disabled={busy} onClick={() => setStep('dev-redeploy')}>
              Redéployer la dev
            </Button>
          </div>
          <ul class="mt-3 space-y-1 text-xs text-[var(--color-ink-muted)]">
            <li>Reprend les variables d’environnement de la prod.</li>
            <li>Même protection d’accès (SSO) que la prod.</li>
            <li>Conteneur séparé, sans ports publiés ni dossiers montés de la prod.</li>
            <li>
              {data.auto_deploy
                ? `Redéployée automatiquement à chaque push sur ${dev.branch}.`
                : 'Déploiement automatique coupé : redéploie à la main.'}
            </li>
          </ul>
        </Card>
      )}

      {/* Production : choix + confirmation */}
      <Modal
        open={step === 'prod'}
        onClose={() => setStep(null)}
        title="Branche de production"
        description={`Actuelle : ${prod}. Le prochain déploiement de prod utilisera la branche choisie.`}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStep(null)}>Annuler</Button>
            <Button disabled={!pick || pick === prod} onClick={() => setStep('prod-confirm')}>
              Changer
            </Button>
          </>
        }
      >
        <BranchPicker branches={branches} loading={branchesLoading} value={pick} onChange={setPick} exclude={dev.branch} />
      </Modal>
      <Modal
        open={step === 'prod-confirm'}
        onClose={() => setStep(null)}
        title="Changer la branche de production ?"
        description={`${prod} → ${pick}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setStep('prod')}>Retour</Button>
            <Button variant="secondary" disabled={busy} onClick={() => applyProd(false)}>
              Changer sans redéployer
            </Button>
            <Button disabled={busy} onClick={() => applyProd(true)}>
              {busy ? <Spinner /> : null}
              Changer et redéployer
            </Button>
          </>
        }
      >
        <p class="text-sm text-[var(--color-ink-muted)]">
          Le site en ligne reste sur l’ancienne branche tant que tu ne redéploies pas.
        </p>
      </Modal>

      {/* Dev : choix + confirmation */}
      <Modal
        open={step === 'dev'}
        onClose={() => setStep(null)}
        title={dev.enabled ? 'Branche dev' : 'Activer l’environnement dev'}
        description={`Publiée sur ${devUrlLabel || 'l’URL principale préfixée par dev'}. La prod (${prod}) n’est pas touchée.`}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStep(null)}>Annuler</Button>
            <Button disabled={!pick || pick === prod} onClick={() => setStep('dev-confirm')}>
              Continuer
            </Button>
          </>
        }
      >
        <BranchPicker branches={branches} loading={branchesLoading} value={pick} onChange={setPick} exclude={prod} />
        <p class="mt-3 text-xs text-[var(--color-ink-muted)]">
          La dev reprend les variables d’environnement et la protection SSO de la prod.
        </p>
      </Modal>
      <Modal
        open={step === 'dev-confirm'}
        onClose={() => setStep(null)}
        title="Déployer la dev maintenant ?"
        description={`Branche ${pick} → ${devUrlLabel}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setStep('dev')}>Retour</Button>
            <Button variant="secondary" disabled={busy} onClick={() => applyDev(false)}>
              Enregistrer seulement
            </Button>
            <Button disabled={busy} onClick={() => applyDev(true)}>
              {busy ? <Spinner /> : null}
              Enregistrer et déployer
            </Button>
          </>
        }
      >
        <p class="text-sm text-[var(--color-ink-muted)]">
          Un conteneur DEV séparé est construit depuis {pick}. Ensuite, chaque push sur cette branche le redéploie
          {data.auto_deploy ? '' : ' (auto-deploy coupé sur ce projet)'}.
        </p>
      </Modal>
      <Modal
        open={step === 'dev-off'}
        onClose={() => setStep(null)}
        title="Désactiver l’environnement dev ?"
        description={devUrlLabel ? `${devUrlLabel} ne répondra plus.` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setStep(null)}>Annuler</Button>
            <Button variant="danger" disabled={busy} onClick={disableDev}>
              {busy ? <Spinner /> : null}
              Désactiver et supprimer
            </Button>
          </>
        }
      >
        <p class="text-sm text-[var(--color-ink-muted)]">
          Le conteneur dev et sa route sont supprimés. La prod n’est pas touchée.
        </p>
      </Modal>
      <Modal
        open={step === 'dev-redeploy'}
        onClose={() => setStep(null)}
        title="Redéployer la dev ?"
        description={`${dev.branch} → ${devUrlLabel}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setStep(null)}>Annuler</Button>
            <Button disabled={busy} onClick={redeployDev}>
              {busy ? <Spinner /> : null}
              Redéployer
            </Button>
          </>
        }
      >
        <p class="text-sm text-[var(--color-ink-muted)]">Seul le conteneur DEV est reconstruit.</p>
      </Modal>
    </div>
  );
}
