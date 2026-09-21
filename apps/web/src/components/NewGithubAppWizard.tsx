import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import type { ClusterNode } from '../lib/api';
import { NodeSelect } from './NodeSelect';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  Input,
  ProgressBar,
  useToast,
} from './ui';

type GhRepo = {
  full_name: string;
  name: string;
  owner: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  description?: string | null;
};

type Step = 'repo' | 'branch' | 'build' | 'runtime' | 'env' | 'domain' | 'review';
type DomainMode = 'auto' | 'custom';

const STEPS: Step[] = ['repo', 'branch', 'build', 'runtime', 'env', 'domain', 'review'];

const STEP_LABELS: Record<Step, string> = {
  repo: 'Repo',
  branch: 'Branche',
  build: 'Build',
  runtime: 'Runtime',
  env: 'Env',
  domain: 'Domaine',
  review: 'Revue',
};

function normalizeFqdn(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

function isValidFqdn(host: string): boolean {
  if (!host || host.length > 253 || !host.includes('.')) return false;
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host);
}

const BUILD_PACKS = [
  { id: 'nixpacks', label: 'Nixpacks', hint: 'Détection auto (Node, Python…)' },
  { id: 'dockerfile', label: 'Dockerfile', hint: 'Build via Dockerfile' },
  { id: 'dockercompose', label: 'Docker Compose', hint: 'Stack multi-services' },
  { id: 'static', label: 'Static', hint: 'Fichiers statiques (port 80)' },
] as const;

function countEnvKeys(content: string): number {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('=')).length;
}

export function NewGithubAppWizard({
  bare = false,
}: {
  bare?: boolean;
} = {}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('repo');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GhRepo | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState('main');
  const [buildPack, setBuildPack] = useState<string>('nixpacks');
  const [isStatic, setIsStatic] = useState(false);
  const [port, setPort] = useState(3000);
  const [publishDir, setPublishDir] = useState('');
  const [baseDir, setBaseDir] = useState('/');
  const [composePath, setComposePath] = useState('/docker-compose.yaml');
  const [name, setName] = useState('');
  const [detectLabel, setDetectLabel] = useState<string | null>(null);
  const [dotenv, setDotenv] = useState('');
  const [envFileName, setEnvFileName] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState('');
  const [manualValue, setManualValue] = useState('');
  const [testCommand, setTestCommand] = useState('npm test --if-present');
  const [wildcardDomain, setWildcardDomain] = useState('');
  const [domainMode, setDomainMode] = useState<DomainMode>('auto');
  const [customFqdn, setCustomFqdn] = useState('');
  const [nodes, setNodes] = useState<ClusterNode[]>([]);
  const [serverId, setServerId] = useState('default');

  const idx = STEPS.indexOf(step);
  const projectNamePreview = name.trim() || (selected ? selected.name : 'app');
  const appSlug = projectNamePreview
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const autoUrl =
    wildcardDomain && appSlug ? `https://${appSlug}.${wildcardDomain}` : null;
  const customHost = normalizeFqdn(customFqdn);
  const customUrl = customHost ? `https://${customHost}` : null;
  const productionUrl = domainMode === 'custom' ? customUrl : autoUrl;
  const progress = ((idx + 1) / STEPS.length) * 100;
  const envKeyCount = countEnvKeys(dotenv);

  useEffect(() => {
    if (!wildcardDomain) {
      setDomainMode('custom');
    }
  }, [wildcardDomain]);

  useEffect(() => {
    (async () => {
      try {
        const [s, boot, cluster] = await Promise.all([
          api.githubStatus(),
          api.bootstrap(),
          api.clusterNodes().catch(() => null),
        ]);
        setWildcardDomain(boot.settings?.wildcard_domain || '');
        setConnected(s.connected);
        if (cluster?.nodes?.length) {
          setNodes(cluster.nodes);
        }
        if (s.connected) {
          const r = await api.githubRepos();
          setRepos(r.data);
        }
      } catch (e) {
        setError(String((e as Error).message || e));
      }
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    api
      .githubBranches(selected.owner, selected.name)
      .then((r) => {
        const names = r.data.map((b) => b.name);
        setBranches(names);
        const def = names.includes(selected.default_branch)
          ? selected.default_branch
          : names[0] || 'main';
        setBranch(def);
      })
      .catch(() => {
        setBranches([selected.default_branch]);
        setBranch(selected.default_branch);
      });
  }, [selected]);

  async function runDetect(owner: string, repo: string, br: string) {
    try {
      const r = await api.githubDetect({ owner, repo, branch: br });
      const d = r.detection;
      setBuildPack(d.build_pack);
      setPort(d.port);
      setIsStatic(d.is_static);
      setPublishDir(d.publish_directory || '');
      setBaseDir(d.base_directory || '/');
      if (d.docker_compose_location) setComposePath(d.docker_compose_location);
      setDetectLabel(
        `${d.label} · ${d.build_pack} · :${d.port}${d.is_static ? ' · static' : ''}`,
      );
      if (d.test_command) setTestCommand(d.test_command);
      toast.push({ title: 'Framework détecté', detail: d.label, tone: 'ok' });
    } catch (e) {
      setDetectLabel(null);
      toast.push({ title: 'Détection partielle', detail: String(e), tone: 'warn' });
    }
  }

  function next() {
    setError(null);
    if (step === 'repo' && !selected) {
      setError('Choisis un repository');
      return;
    }
    if (step === 'branch' && !branch.trim()) {
      setError('Branche requise');
      return;
    }
    if (step === 'domain') {
      if (domainMode === 'auto') {
        if (!autoUrl) {
          setError('Domaine wildcard manquant — Settings → Domaine, ou FQDN custom');
          return;
        }
      } else if (!isValidFqdn(customHost)) {
        setError('FQDN invalide (ex. app.example.com)');
        return;
      }
    }
    const i = STEPS.indexOf(step);
    if (step === 'branch' && selected) {
      void runDetect(selected.owner, selected.name, branch);
    }
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]);
  }

  function back() {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
  }

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const projectName = name.trim() || `${selected.owner}-${selected.name}`;
      const p = await api.createProject({
        name: projectName,
        git_repository: selected.html_url.replace(/\.git$/, ''),
        git_branch: branch,
        build_pack: buildPack,
        port,
        is_static: isStatic,
        publish_directory: publishDir.trim() || null,
        base_directory: baseDir.trim() || '/',
        docker_compose_location:
          buildPack === 'dockercompose' ? composePath.trim() || '/docker-compose.yaml' : null,
        server_id: serverId || 'default',
        test_command: testCommand || 'npm test --if-present',
        production_url: productionUrl,
      });
      if (dotenv.trim()) {
        const imported = await api.envImport(p.data.uuid, dotenv, true);
        toast.push({
          title: 'Env importées',
          detail: `${imported.imported} nouvelle(s), ${imported.updated ?? 0} mise(s) à jour, ${imported.unchanged ?? 0} inchangée(s)`,
          tone: 'ok',
        });
      }
      toast.push({
        title: 'Application créée',
        detail: p.data.production_url || productionUrl || `${selected.full_name}@${branch}`,
        tone: 'ok',
      });
      window.location.href = `/app/projects/view?uuid=${encodeURIComponent(p.data.uuid)}&tab=overview`;
    } catch (e) {
      setError(String((e as Error).message || e));
      setBusy(false);
    }
  }

  async function onEnvFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    setDotenv(text);
    setEnvFileName(file.name);
    toast.push({
      title: 'Fichier .env chargé',
      detail: `${countEnvKeys(text)} clé(s) · ${file.name}`,
      tone: 'ok',
    });
  }

  function addManualEnv(e: Event) {
    e.preventDefault();
    const k = manualKey.trim();
    if (!k) return;
    const line = `${k}=${manualValue}`;
    setDotenv((prev) => {
      const lines = prev
        .split('\n')
        .map((l) => l.trimEnd())
        .filter(Boolean);
      const without = lines.filter((l) => {
        const t = l.trim();
        if (!t || t.startsWith('#')) return true;
        const key = t.split('=')[0]?.trim();
        return key !== k;
      });
      without.push(line);
      return without.join('\n') + '\n';
    });
    setManualKey('');
    setManualValue('');
  }

  const filtered = repos.filter((r) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      r.full_name.toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q)
    );
  });

  if (!connected) {
    return (
      <Alert tone="warn">
        GitHub non connecté — configure un token dans{' '}
        <a class="underline" href="/app/settings">
          Settings
        </a>{' '}
        avant d’ajouter une app.
      </Alert>
    );
  }

  const body = (
    <>
      <div class="mb-4">
        <div class="mb-1 flex justify-between text-xs text-[var(--color-ink-faint)]">
          <span>
            {idx + 1}/{STEPS.length}
          </span>
          <span>{STEP_LABELS[step]}</span>
        </div>
        <ProgressBar value={progress} />
      </div>

      {error && (
        <Alert tone="danger" class="mb-3">
          {error}
        </Alert>
      )}

      {step === 'repo' && (
        <div class="space-y-3">
          <Input
            placeholder="Filtrer les repos…"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
          <div class="max-h-64 overflow-auto rounded-xl border border-[var(--color-line)]">
            {filtered.slice(0, 50).map((r) => (
              <button
                key={r.full_name}
                type="button"
                class={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-white/5 ${
                  selected?.full_name === r.full_name ? 'bg-white/5' : ''
                }`}
                onClick={() => {
                  setSelected(r);
                  setName(r.name);
                }}
              >
                <span>
                  <span class="font-medium">{r.full_name}</span>
                  {r.description && (
                    <span class="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                      {r.description}
                    </span>
                  )}
                </span>
                <Badge tone={r.private ? 'warn' : 'neutral'}>
                  {r.private ? 'privé' : 'public'}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'branch' && selected && (
        <div class="space-y-3">
          <p class="text-sm text-[var(--color-ink-muted)]">
            Repo : <span class="font-medium text-[var(--color-ink)]">{selected.full_name}</span>
          </p>
          <label class="flex flex-col gap-1.5 text-sm">
            <span class="font-medium">Branche</span>
            <select
              class="h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3"
              value={branch}
              onChange={(e) => setBranch((e.target as HTMLSelectElement).value)}
            >
              {(branches.length ? branches : [selected.default_branch]).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <Input
            label="Nom de l’application"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </div>
      )}

      {step === 'build' && (
        <div class="space-y-3">
          {detectLabel && <Alert tone="ok">Détecté : {detectLabel}</Alert>}
          <div class="grid gap-2 sm:grid-cols-2">
            {BUILD_PACKS.map((bp) => (
              <button
                key={bp.id}
                type="button"
                class={`rounded-xl border px-3 py-3 text-left ${
                  buildPack === bp.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-line)] hover:bg-white/5'
                }`}
                onClick={() => setBuildPack(bp.id)}
              >
                <div class="text-sm font-medium">{bp.label}</div>
                <div class="mt-1 text-xs text-[var(--color-ink-muted)]">{bp.hint}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'runtime' && (
        <div class="space-y-3">
          {(buildPack === 'nixpacks' || buildPack === 'static') && buildPack !== 'static' && (
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isStatic}
                onChange={(e) => setIsStatic((e.target as HTMLInputElement).checked)}
              />
              Site statique (publish directory)
            </label>
          )}
          <Input
            label="Port exposé"
            type="number"
            value={String(port)}
            onInput={(e) => setPort(Number((e.target as HTMLInputElement).value) || 80)}
          />
          {(isStatic || buildPack === 'static') && (
            <Input
              label="Publish directory"
              value={publishDir}
              placeholder="/dist"
              onInput={(e) => setPublishDir((e.target as HTMLInputElement).value)}
            />
          )}
          <Input
            label="Base directory"
            value={baseDir}
            placeholder="/"
            onInput={(e) => setBaseDir((e.target as HTMLInputElement).value)}
          />
          <NodeSelect
            nodes={nodes}
            value={serverId}
            onChange={setServerId}
            hint="La forge tourne uniquement sur ce nœud. Pas de copie automatique sur les autres."
          />
          {buildPack === 'dockercompose' && (
            <Input
              label="Chemin docker-compose"
              value={composePath}
              onInput={(e) => setComposePath((e.target as HTMLInputElement).value)}
            />
          )}
        </div>
      )}

      {step === 'env' && (
        <div class="space-y-4">
          <p class="text-sm text-[var(--color-ink-muted)]">
            Optionnel — importe un <code class="font-mono text-xs">.env</code> ou colle les
            variables. Elles seront enregistrées à la création du projet.
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <label class="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm hover:bg-white/5">
              <input
                type="file"
                accept=".env,text/plain,.env.*"
                class="hidden"
                onChange={onEnvFile}
              />
              Importer un fichier .env
            </label>
            {envFileName && (
              <span class="text-xs text-[var(--color-ink-muted)]">{envFileName}</span>
            )}
            {envKeyCount > 0 && <Badge tone="ok">{envKeyCount} clé(s)</Badge>}
            {dotenv.trim() && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDotenv('');
                  setEnvFileName(null);
                }}
              >
                Effacer
              </Button>
            )}
          </div>
          <textarea
            class="min-h-[160px] w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 font-mono text-xs"
            placeholder={'DATABASE_URL=…\nAPI_KEY=…'}
            value={dotenv}
            onInput={(e) => {
              setDotenv((e.target as HTMLTextAreaElement).value);
              setEnvFileName(null);
            }}
          />
          <form class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end" onSubmit={addManualEnv}>
            <div class="w-full sm:w-36 sm:shrink-0">
              <Input
                label="Clé"
                placeholder="KEY"
                value={manualKey}
                onInput={(e) => setManualKey((e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="min-w-0 w-full flex-1">
              <Input
                label="Valeur"
                placeholder="value"
                value={manualValue}
                onInput={(e) => setManualValue((e.target as HTMLInputElement).value)}
              />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={!manualKey.trim()} class="w-full sm:w-auto">
              Ajouter
            </Button>
          </form>
        </div>
      )}

      {step === 'domain' && (
        <div class="space-y-4">
          <p class="text-sm text-[var(--color-ink-muted)]">
            Choisis l’URL publique de l’app. Le proxy (Traefik) utilisera ce FQDN.
          </p>
          <Input
            label="Nom de l’application"
            value={name}
            placeholder={selected?.name || 'mon-app'}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            hint="Sert aussi pour le sous-domaine auto"
          />
          <div class="space-y-2">
            <button
              type="button"
              class={`w-full rounded-xl border px-3 py-3 text-left text-sm transition ${
                domainMode === 'auto'
                  ? 'border-[var(--color-accent)] bg-white/5'
                  : 'border-[var(--color-line)] hover:bg-white/5'
              } ${!wildcardDomain ? 'opacity-50' : ''}`}
              disabled={!wildcardDomain}
              onClick={() => setDomainMode('auto')}
            >
              <div class="font-medium">Sous-domaine auto</div>
              <div class="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                {autoUrl || (
                  <>
                    Wildcard manquant —{' '}
                    <a class="underline" href="/app/settings?tab=domaine">
                      Settings → Domaine
                    </a>
                  </>
                )}
              </div>
            </button>
            <button
              type="button"
              class={`w-full rounded-xl border px-3 py-3 text-left text-sm transition ${
                domainMode === 'custom'
                  ? 'border-[var(--color-accent)] bg-white/5'
                  : 'border-[var(--color-line)] hover:bg-white/5'
              }`}
              onClick={() => setDomainMode('custom')}
            >
              <div class="font-medium">FQDN custom</div>
              <div class="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                Ex. starbasefr.com ou app.jeser.app
              </div>
            </button>
          </div>
          {domainMode === 'custom' && (
            <Input
              label="Nom de domaine"
              placeholder="app.example.com"
              value={customFqdn}
              onInput={(e) => setCustomFqdn((e.target as HTMLInputElement).value)}
              hint={customUrl ? `URL → ${customUrl}` : 'Sans https://'}
            />
          )}
          {productionUrl && (
            <div class="rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm">
              <span class="text-[var(--color-ink-muted)]">URL finale </span>
              <span class="font-medium">{productionUrl}</span>
            </div>
          )}
        </div>
      )}

      {step === 'review' && selected && (
        <ul class="space-y-2 text-sm">
          <li>
            <span class="text-[var(--color-ink-muted)]">App </span>
            {name || selected.name}
          </li>
          <li>
            <span class="text-[var(--color-ink-muted)]">Git </span>
            {selected.full_name}@{branch}
          </li>
          <li>
            <span class="text-[var(--color-ink-muted)]">Build </span>
            {buildPack}
            {isStatic ? ' · static' : ''}
          </li>
          <li>
            <span class="text-[var(--color-ink-muted)]">Port </span>
            {port}
          </li>
          <li>
            <span class="text-[var(--color-ink-muted)]">Base </span>
            {baseDir || '/'}
          </li>
          {detectLabel && (
            <li>
              <span class="text-[var(--color-ink-muted)]">Detect </span>
              {detectLabel}
            </li>
          )}
          <li>
            <span class="text-[var(--color-ink-muted)]">Domaine </span>
            {productionUrl || (
              <span class="text-[var(--color-warn)]">non défini</span>
            )}
            {domainMode === 'custom' ? ' · custom' : ' · auto'}
          </li>
          <li>
            <span class="text-[var(--color-ink-muted)]">Nœud </span>
            {nodes.find((n) => n.id === serverId)?.name || serverId}
          </li>
          <li>
            <span class="text-[var(--color-ink-muted)]">Env </span>
            {envKeyCount > 0
              ? `${envKeyCount} variable${envKeyCount > 1 ? 's' : ''}${
                  envFileName ? ` · ${envFileName}` : ''
                }`
              : 'Aucune (tu pourras les ajouter après)'}
          </li>
        </ul>
      )}

      <div class="mt-5 flex flex-wrap justify-between gap-2">
        <Button variant="ghost" size="sm" disabled={idx === 0 || busy} onClick={back}>
          Retour
        </Button>
        {step !== 'review' ? (
          <Button size="sm" onClick={next}>
            Continuer
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy} onClick={submit}>
            {busy ? 'Création…' : 'Créer l’application'}
          </Button>
        )}
      </div>
    </>
  );

  return (
    <FadeIn>
      {bare ? (
        body
      ) : (
        <Card>
          <CardHeader
            title="Nouvelle app depuis GitHub"
            description="Wizard de configuration (comme sur l’ancien DevForge)."
          />
          {body}
        </Card>
      )}
    </FadeIn>
  );
}
