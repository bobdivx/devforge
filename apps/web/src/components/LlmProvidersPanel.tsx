import { useEffect, useState } from 'preact/hooks';
import { api, type LlmProviderRow } from '../lib/api';
import { AUTO_MODEL_VALUE, isModelTooSmallForTools, SMALL_MODEL_TOOLS_WARNING } from '../lib/llm-models';
import { cn } from '../lib/cn';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  Input,
  Modal,
  useToast,
} from './ui';

type CatalogItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  docs_url?: string | null;
  default_url?: string | null;
  provider: string;
  fields: Array<{
    key: string;
    label: string;
    placeholder?: string | null;
    secret: boolean;
    required: boolean;
    help?: string | null;
  }>;
  popular: boolean;
  icon_domain?: string | null;
};

function LlmIcon({
  domain,
  name,
  size = 'md',
}: {
  domain?: string | null;
  name: string;
  size?: 'sm' | 'md';
}) {
  const [failed, setFailed] = useState(false);
  const dim = size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl';
  const src =
    domain && !failed
      ? `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(domain)}`
      : null;

  return (
    <div
      class={cn(
        'flex shrink-0 items-center justify-center overflow-hidden bg-[#2a2a2e] text-sm font-semibold text-[var(--color-ink-muted)]',
        dim,
      )}
      aria-hidden
    >
      {src ? (
        <img
          src={src}
          alt=""
          class="h-full w-full object-contain p-1.5"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{(name[0] || '?').toUpperCase()}</span>
      )}
    </div>
  );
}

function CatalogCard({
  item,
  count,
  onOpen,
}: {
  item: CatalogItem;
  count: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      class={cn(
        'group flex items-center gap-3 rounded-2xl border bg-[var(--color-card)] px-3.5 py-3 text-left transition',
        'border-[var(--color-line)] hover:border-[var(--color-line-strong)] hover:bg-[#16161a]',
      )}
    >
      <LlmIcon domain={item.icon_domain} name={item.name} />
      <div class="min-w-0 flex-1">
        <div class="truncate font-medium tracking-tight">{item.name}</div>
      </div>
      {count > 0 ? (
        <Badge tone="ok" class="shrink-0">
          {count}
        </Badge>
      ) : (
        <span class="shrink-0 text-xs text-[var(--color-ink-faint)] opacity-0 transition group-hover:opacity-100">
          Ajouter
        </span>
      )}
    </button>
  );
}

function suggestInstanceName(catalogName: string, existing: LlmProviderRow[], catalogId: string): string {
  const same = existing.filter((p) => p.catalog_id === catalogId);
  if (same.length === 0) return catalogName;
  return `${catalogName} ${same.length + 1}`;
}

export function LlmProvidersPanel({
  isAdmin,
  activeMode,
  onModeChange,
}: {
  isAdmin: boolean;
  activeMode?: string;
  onModeChange?: (mode: string) => void;
}) {
  const toast = useToast();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [providers, setProviders] = useState<LlmProviderRow[]>([]);
  const [mode, setMode] = useState(activeMode || 'stub');
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<CatalogItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [models, setModels] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [instanceName, setInstanceName] = useState('');
  const [makeActive, setMakeActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [probing, setProbing] = useState(false);

  async function load() {
    try {
      const [c, p] = await Promise.all([api.llmCatalog(), api.llmProviders()]);
      setCatalog(c.data ?? []);
      setProviders(p.data ?? []);
      setMode(p.active_mode || 'stub');
      onModeChange?.(p.active_mode || 'stub');
      setError(null);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin]);

  /** Carte catalogue = toujours une nouvelle instance. */
  function openCreate(item: CatalogItem) {
    setPreset(item);
    setEditingId(null);
    setInstanceName(suggestInstanceName(item.name, providers, item.id));
    setMakeActive(providers.length === 0);
    const init: Record<string, string> = {};
    for (const f of item.fields) {
      if (f.key === 'base_url') init.base_url = item.default_url || '';
      else if (f.key === 'api_key') init.api_key = '';
      else if (f.key === 'model') init.model = f.placeholder || AUTO_MODEL_VALUE;
      else init[f.key] = '';
    }
    setFields(init);
    setModels([]);
  }

  /** Édition depuis la liste configurés. */
  function openEdit(item: CatalogItem, existing: LlmProviderRow) {
    setPreset(item);
    setEditingId(existing.id);
    setInstanceName(existing.name);
    setMakeActive(existing.is_default);
    const init: Record<string, string> = {};
    for (const f of item.fields) {
      if (f.key === 'base_url') init.base_url = existing.base_url || item.default_url || '';
      else if (f.key === 'api_key') init.api_key = '';
      else if (f.key === 'model') init.model = existing.model || f.placeholder || AUTO_MODEL_VALUE;
      else init[f.key] = '';
    }
    setFields(init);
    setModels([]);
  }

  async function loadModels(silent = false) {
    if (!preset) return;
    setModelsBusy(true);
    try {
      const r = await api.llmModels({
        provider: preset.provider,
        base_url: fields.base_url?.trim() || preset.default_url || undefined,
        api_key: fields.api_key?.trim() || undefined,
      });
      setModels(r.models);
      if (r.models.length && fields.model && !r.models.includes(fields.model) && fields.model !== AUTO_MODEL_VALUE) {
        setFields((prev) => ({ ...prev, model: r.models[0] }));
      }
      if (!silent) {
        toast.push({ title: 'Modèles', detail: `${r.models.length} trouvé(s)`, tone: 'ok' });
      }
    } catch (err) {
      if (!silent) {
        toast.push({ title: 'Modèles KO', detail: String(err), tone: 'danger' });
      }
    } finally {
      setModelsBusy(false);
    }
  }

  // Auto-discover quand URL/clé prêts
  useEffect(() => {
    if (!preset) return;
    const needsKey = preset.fields.some((f) => f.key === 'api_key' && f.required);
    const hasKey =
      (fields.api_key?.trim().length ?? 0) >= 8 ||
      (!!editingId && providers.find((p) => p.id === editingId)?.has_api_key);
    const hasUrl = (fields.base_url?.trim().length ?? 0) > 0 || !!preset.default_url;
    if (needsKey && !hasKey) return;
    if (preset.provider === 'ollama' && !fields.base_url?.trim()) return;
    if (!hasUrl && needsKey) return;
    const t = window.setTimeout(() => {
      void loadModels(true);
    }, 450);
    return () => window.clearTimeout(t);
  }, [preset?.id, fields.base_url, fields.api_key, editingId]);

  async function submit(e: Event) {
    e.preventDefault();
    if (!preset) return;
    setBusy(true);
    try {
      const name =
        instanceName.trim() ||
        suggestInstanceName(preset.name, providers, preset.id);
      const activate = editingId
        ? makeActive
        : makeActive || providers.length === 0;
      const r = await api.llmUpsertProvider({
        id: editingId || undefined,
        catalog_id: preset.id,
        name,
        provider: preset.provider,
        is_default: activate,
        fields: { ...fields },
        api_key: fields.api_key?.trim() || undefined,
        base_url: fields.base_url?.trim() || preset.default_url || undefined,
        model: fields.model?.trim() || AUTO_MODEL_VALUE,
      });
      toast.push({
        title: activate ? `${name} en tête` : `${name} enregistré`,
        detail: r.active_mode,
        tone: 'ok',
      });
      setPreset(null);
      setEditingId(null);
      await load();
    } catch (err) {
      toast.push({ title: 'Config KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Retirer ce provider ?')) return;
    setBusy(true);
    try {
      await api.llmDeleteProvider(id);
      toast.push({ title: 'Provider retiré', tone: 'info' });
      await load();
    } catch (err) {
      toast.push({ title: 'Delete KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string) {
    setTesting((t) => ({ ...t, [id]: true }));
    try {
      const r = await api.llmTestProvider(id);
      toast.push({
        title: 'Test OK',
        detail: r.resolved_model ? `${r.message}` : r.message,
        tone: 'ok',
      });
      if (r.active_mode) {
        setMode(r.active_mode);
        onModeChange?.(r.active_mode);
      }
      await load();
    } catch (err) {
      toast.push({ title: 'Test KO', detail: String(err), tone: 'danger' });
      await load();
    } finally {
      setTesting((t) => ({ ...t, [id]: false }));
    }
  }

  async function probeAll() {
    setProbing(true);
    try {
      const r = await api.llmProbeProviders();
      setMode(r.active_mode);
      onModeChange?.(r.active_mode);
      toast.push({
        title: 'Health check',
        detail: `${r.healthy}/${r.total} OK · ${r.active_mode}`,
        tone: r.healthy > 0 ? 'ok' : 'warn',
      });
      await load();
    } catch (err) {
      toast.push({ title: 'Probe KO', detail: String(err), tone: 'danger' });
    } finally {
      setProbing(false);
    }
  }

  async function move(id: string, dir: -1 | 1) {
    const ordered = [...providers].sort(
      (a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name),
    );
    const idx = ordered.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= ordered.length) return;
    const next = [...ordered];
    const tmp = next[idx];
    next[idx] = next[j];
    next[j] = tmp;
    setBusy(true);
    try {
      const r = await api.llmReorderProviders(next.map((p) => p.id));
      toast.push({ title: 'Priorité mise à jour', detail: r.active_mode, tone: 'ok' });
      await load();
    } catch (err) {
      toast.push({ title: 'Reorder KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function goStub() {
    setBusy(true);
    try {
      await api.llmDisconnect();
      toast.push({ title: 'Mode stub', tone: 'info' });
      await load();
    } catch (err) {
      toast.push({ title: 'Erreur', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <Alert tone="warn">Réservé à l’admin d’instance. Mode actuel : {mode}</Alert>
    );
  }

  const local = catalog.filter((c) => c.category === 'local');
  const cloud = catalog.filter((c) => c.category === 'cloud');
  const countByCatalog = (id: string) =>
    providers.filter((p) => p.catalog_id === id).length;

  return (
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-[var(--color-ink-muted)]">
          Seuls les LLM qui passent le health check (chat réel) entrent dans la chaîne.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={probing || busy || providers.length === 0}
            onClick={() => void probeAll()}
          >
            {probing ? 'Vérification…' : 'Vérifier tous'}
          </Button>
          <Badge tone={mode !== 'stub' ? 'ok' : 'warn'}>{mode}</Badge>
        </div>
      </div>

      {error && (
        <Alert tone="warn" class="mb-2">
          {error}
        </Alert>
      )}

      <FadeIn>
        <section>
          <h2 class="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
            Local
          </h2>
          <div class="grid gap-2 sm:grid-cols-2">
            {local.map((p) => (
              <CatalogCard
                key={p.id}
                item={p}
                count={countByCatalog(p.id)}
                onOpen={() => openCreate(p)}
              />
            ))}
          </div>
        </section>
      </FadeIn>

      <FadeIn delay={40}>
        <section>
          <h2 class="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
            Cloud
          </h2>
          <div class="grid gap-2 sm:grid-cols-2">
            {cloud.map((p) => (
              <CatalogCard
                key={p.id}
                item={p}
                count={countByCatalog(p.id)}
                onOpen={() => openCreate(p)}
              />
            ))}
          </div>
        </section>
      </FadeIn>

      <FadeIn delay={80}>
        <Card>
          <CardHeader
            title="Configurés"
            action={
              <Button size="sm" variant="ghost" disabled={busy} onClick={goStub}>
                Stub
              </Button>
            }
          />
          {providers.length === 0 ? (
            <p class="text-sm text-[var(--color-ink-muted)]">
              Aucun provider — clique une carte ci-dessus.
            </p>
          ) : (
            <ul class="divide-y divide-[var(--color-line)]">
              {[...providers]
                .sort(
                  (a, b) =>
                    (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name),
                )
                .map((p, rank) => {
                const cat = catalog.find((c) => c.id === p.catalog_id);
                const defaultUrl = (cat?.default_url || '').replace(/\/+$/, '');
                const storedUrl = (p.base_url || '').replace(/\/+$/, '');
                const showUrl =
                  !!storedUrl &&
                  storedUrl !== defaultUrl &&
                  !/^https:\/\/(api\.openai\.com|openrouter\.ai|generativelanguage\.googleapis\.com|api\.anthropic\.com)/i.test(
                    storedUrl,
                  );
                return (
                  <li
                    key={p.id}
                    class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div class="flex min-w-0 items-center gap-3">
                      <LlmIcon domain={cat?.icon_domain} name={p.name} size="sm" />
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <Badge tone={rank === 0 ? 'ok' : 'accent'} class="shrink-0">
                            #{rank + 1}
                          </Badge>
                          <span class="truncate font-medium">{p.name}</span>
                          {p.healthy === false ? (
                            <Badge tone="danger" title={p.last_probe_error || 'KO'}>
                              KO
                            </Badge>
                          ) : p.in_chain !== false ? (
                            <Badge tone="ok">actif</Badge>
                          ) : null}
                          {!p.enabled && <Badge tone="warn">off</Badge>}
                        </div>
                        <div class="mt-0.5 truncate font-mono text-xs text-[var(--color-ink-faint)]">
                          {p.resolved_model || p.model || 'auto'}
                          {showUrl ? ` · ${p.base_url}` : ''}
                          {p.has_api_key ? ` · ${p.key_hint}` : ''}
                          {p.healthy === false && p.last_probe_error
                            ? ` · ${p.last_probe_error.slice(0, 80)}`
                            : ''}
                        </div>
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || rank === 0}
                        onClick={() => move(p.id, -1)}
                        title="Monter (priorité plus haute)"
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || rank >= providers.length - 1}
                        onClick={() => move(p.id, 1)}
                        title="Descendre (fallback)"
                      >
                        ↓
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={testing[p.id]}
                        onClick={() => test(p.id)}
                      >
                        {testing[p.id] ? '…' : 'Tester'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const item =
                            cat ||
                            catalog.find((c) => c.provider === p.provider) ||
                            catalog.find((c) => c.id === 'custom');
                          if (item) openEdit(item, p);
                        }}
                      >
                        Éditer
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(p.id)}>
                        Retirer
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </FadeIn>

      <Modal
        open={!!preset}
        onClose={() => {
          setPreset(null);
          setEditingId(null);
        }}
        title={
          preset
            ? editingId
              ? `Modifier ${instanceName || preset.name}`
              : `Ajouter ${preset.name}`
            : 'LLM'
        }
        description={preset?.description}
        size="lg"
        footer={
          preset ? (
            <>
              {preset.docs_url && (
                <Button href={preset.docs_url} size="sm" variant="ghost" target="_blank">
                  Docs
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setPreset(null);
                  setEditingId(null);
                }}
              >
                Annuler
              </Button>
              <Button type="submit" form="llm-provider-form" size="sm" disabled={busy}>
                {busy ? '…' : editingId ? 'Enregistrer' : 'Ajouter'}
              </Button>
            </>
          ) : null
        }
      >
        {preset && (
          <form id="llm-provider-form" class="space-y-3" onSubmit={submit}>
            <div class="mb-1 flex items-center gap-3">
              <LlmIcon domain={preset.icon_domain} name={preset.name} />
              <span class="text-sm text-[var(--color-ink-muted)]">
                {editingId ? 'modifier' : 'nouvelle instance'}
              </span>
            </div>

            <Input
              label="Nom"
              placeholder={preset.name}
              value={instanceName}
              onInput={(e) => setInstanceName((e.target as HTMLInputElement).value)}
              required
            />

            {preset.fields.map((f) => {
              if (f.key === 'model') {
                return (
                  <div key={f.key}>
                    <label class="mb-1.5 block text-sm font-medium">Modèle</label>
                    <div class="flex gap-2">
                      <select
                        class="h-10 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm"
                        value={
                          fields.model === AUTO_MODEL_VALUE ||
                          !fields.model ||
                          models.includes(fields.model) ||
                          models.length === 0
                            ? fields.model || AUTO_MODEL_VALUE
                            : AUTO_MODEL_VALUE
                        }
                        onChange={(e) =>
                          setFields((prev) => ({
                            ...prev,
                            model: (e.target as HTMLSelectElement).value,
                          }))
                        }
                      >
                        <option value={AUTO_MODEL_VALUE}>Auto</option>
                        {models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={modelsBusy}
                        onClick={() => void loadModels()}
                      >
                        {modelsBusy ? '…' : 'Charger'}
                      </Button>
                    </div>
                    {f.help && (
                      <p class="mt-1 text-xs text-[var(--color-ink-faint)]">{f.help}</p>
                    )}
                    {isModelTooSmallForTools(fields.model) && (
                      <Alert tone="warn" class="mt-2">
                        {SMALL_MODEL_TOOLS_WARNING}
                      </Alert>
                    )}
                  </div>
                );
              }
              return (
                <div key={f.key}>
                  <Input
                    label={f.label}
                    type={f.secret ? 'password' : 'text'}
                    placeholder={
                      f.secret && editingId
                        ? '•••• (inchangé si vide)'
                        : f.placeholder || ''
                    }
                    value={fields[f.key] || ''}
                    onInput={(e) =>
                      setFields((prev) => ({
                        ...prev,
                        [f.key]: (e.target as HTMLInputElement).value,
                      }))
                    }
                    required={f.required && !(f.secret && editingId)}
                  />
                  {f.help && (
                    <p class="mt-1 text-xs text-[var(--color-ink-faint)]">{f.help}</p>
                  )}
                </div>
              );
            })}

            <label class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
              <input
                type="checkbox"
                checked={makeActive}
                onChange={(e) => setMakeActive((e.target as HTMLInputElement).checked)}
                class="rounded border-[var(--color-line)]"
              />
              Priorité haute (essayer en premier)
            </label>
          </form>
        )}
      </Modal>
    </div>
  );
}
