import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { AppShell } from './AppShell';
import {
  Alert,
  Badge,
  Button,
  HubAddTile,
  HubGrid,
  HubTile,
  Input,
  Modal,
  Skeleton,
  useToast,
} from './ui';

type CatalogItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  docs_url?: string | null;
  default_url?: string | null;
  auth_mode?: string | null;
  fields: Array<{
    key: string;
    label: string;
    placeholder?: string | null;
    secret: boolean;
    required: boolean;
    help?: string | null;
  }>;
  resource_kind?: string | null;
  popular: boolean;
  setup_intro?: string | null;
  setup_sections?: Array<{ title: string; body: string }> | null;
  tools_help?: string | null;
};

type McpServer = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  catalog_id?: string | null;
  meta: Record<string, string>;
  has_secrets: boolean;
  secret_keys: string[];
  oauth_connected?: boolean;
  oauth_expires_at?: string;
  oauth_scopes?: string;
};

const ICON_DOMAIN: Record<string, string> = {
  turso: 'turso.tech',
  cloudflare: 'cloudflare.com',
  vercel: 'vercel.com',
  supabase: 'supabase.com',
  neon: 'neon.tech',
  upstash: 'upstash.com',
  slack: 'slack.com',
  linear: 'linear.app',
  sentry: 'sentry.io',
  resend: 'resend.com',
  posthog: 'posthog.com',
  discord: 'discord.com',
  railway: 'railway.app',
  notion: 'notion.so',
  stripe: 'stripe.com',
  github: 'github.com',
};

function iconCandidates(id: string): string[] {
  const domain = ICON_DOMAIN[id];
  if (!domain) return [];
  return [
    `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(domain)}`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
  ];
}

function McpIcon({
  id,
  name,
  size = 'md',
}: {
  id: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const candidates = iconCandidates(id);
  const [idx, setIdx] = useState(0);
  const src = candidates[idx];
  const dim =
    size === 'sm'
      ? 'h-8 w-8 rounded-lg'
      : size === 'lg'
        ? 'h-full w-full'
        : 'h-10 w-10 rounded-xl';
  const bare = size === 'lg';

  useEffect(() => {
    setIdx(0);
  }, [id]);

  return (
    <div
      class={cn(
        'flex shrink-0 items-center justify-center overflow-hidden text-sm font-semibold text-[var(--color-ink-muted)]',
        bare ? 'bg-transparent' : 'bg-[#2a2a2e]',
        dim,
      )}
      aria-hidden
    >
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          class={cn('h-full w-full object-contain', bare ? 'p-2.5' : 'p-1.5')}
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          onError={() => setIdx((i) => i + 1)}
        />
      ) : (
        <span>{(name[0] || '?').toUpperCase()}</span>
      )}
    </div>
  );
}

function statusMeta(
  server: McpServer,
  toolsChecked?: boolean,
  toolsOk?: boolean,
): { label: string; tone: 'ok' | 'warn' | 'neutral' } {
  if (!server.enabled) return { label: 'Désactivé', tone: 'neutral' };
  if (toolsChecked === false || toolsOk === undefined) {
    return { label: 'Connecté', tone: 'ok' };
  }
  if (toolsOk) return { label: 'Connecté', tone: 'ok' };
  return { label: 'Limité', tone: 'warn' };
}

function statusDotClass(tone: 'ok' | 'warn' | 'neutral' | 'danger') {
  if (tone === 'ok') return 'bg-[var(--color-ok)]';
  if (tone === 'warn') return 'bg-[var(--color-warn)]';
  if (tone === 'danger') return 'bg-[var(--color-danger)]';
  return 'bg-[var(--color-ink-faint)]';
}

function ServerCard({
  server,
  index,
  onOpen,
  toolsOk,
}: {
  server: McpServer;
  index: number;
  onOpen: () => void;
  toolsOk?: boolean;
}) {
  const toolsChecked = toolsOk !== undefined;
  const status = statusMeta(server, toolsChecked, toolsOk);
  
  // Afficher meta utiles (org, project_ref, team_id, host, etc.) mais jamais l'URL hostname
  const detail =
    server.meta?.org ||
    server.meta?.project_ref ||
    server.meta?.team_id ||
    server.meta?.host ||
    (server.has_secrets ? 'Secrets configurés' : undefined);

  return (
    <HubTile
      index={index}
      title={server.name}
      onClick={onOpen}
      iconClass="!bg-[#2a2a2e]"
      icon={<McpIcon id={server.catalog_id || 'custom'} name={server.name} size="lg" />}
      badge={
        <span
          class={cn(
            'absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full ring-2 ring-[#1c1c1e]',
            statusDotClass(status.tone),
            status.tone === 'ok' ? 'animate-pulse' : '',
          )}
          title={status.label}
          aria-hidden
        />
      }
      subtitle={
        <div class="mt-1 space-y-0.5">
          <div
            class={cn(
              'text-[11px] font-medium',
              status.tone === 'ok' && 'text-[var(--color-ok)]',
              status.tone === 'warn' && 'text-[var(--color-warn)]',
              status.tone === 'neutral' && 'text-[var(--color-ink-faint)]',
            )}
          >
            {status.label}
          </div>
          {detail && (
            <div class="truncate text-[10px] text-[var(--color-ink-faint)]" title={detail}>
              {detail}
            </div>
          )}
        </div>
      }
    />
  );
}

function CatalogPickCard({
  item,
  index,
  alreadyConnected,
  onOpen,
}: {
  item: CatalogItem;
  index: number;
  alreadyConnected: boolean;
  onOpen: () => void;
}) {
  return (
    <HubTile
      index={index}
      title={item.name}
      description={item.description || item.category}
      onClick={onOpen}
      iconClass="!bg-[#2a2a2e] !text-[var(--color-ink-muted)]"
      icon={<McpIcon id={item.id} name={item.name} size="lg" />}
      badge={
        alreadyConnected ? (
          <span class="absolute -right-1 -top-1 rounded-full bg-[var(--color-ok)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-950 ring-2 ring-[#1c1c1e]">
            OK
          </span>
        ) : null
      }
      class={alreadyConnected ? 'opacity-70' : undefined}
    />
  );
}

export function McpPage() {
  const toast = useToast();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preset, setPreset] = useState<CatalogItem | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState<McpServer | null>(null);
  const [tools, setTools] = useState<Array<{ name: string; description: string }>>([]);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsStatusMap, setToolsStatusMap] = useState<Record<string, boolean>>({});

  async function load() {
    try {
      const [c, s] = await Promise.all([api.mcpCatalog(), api.mcpServers()]);
      setCatalog(c.data ?? []);
      setServers(s.data ?? []);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openPreset(p: CatalogItem) {
    setPickerOpen(false);
    setPreset(p);
    const init: Record<string, string> = {};
    for (const f of p.fields) {
      if (f.key === 'url' && p.default_url) init.url = p.default_url;
      else init[f.key] = '';
    }
    setFields(init);
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!preset) return;
    setBusy(true);
    try {
      await api.mcpUpsert({
        catalog_id: preset.id,
        fields: { ...fields },
      });
      toast.push({ title: `${preset.name} connecté`, tone: 'ok' });
      setPreset(null);
      await load();
    } catch (err) {
      toast.push({ title: 'Config KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api.mcpDelete(id);
      toast.push({ title: 'MCP retiré', tone: 'info' });
      setManage(null);
      await load();
    } catch (err) {
      toast.push({ title: 'Delete KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function openManage(server: McpServer) {
    setManage(server);
    setTools([]);
    setToolsError(null);
    if (!server.url) {
      setToolsLoading(false);
      return;
    }
    setToolsLoading(true);
    try {
      const r = await api.mcpTools(server.id);
      setTools(r.data ?? []);
      if (!(r.data ?? []).length) {
        setToolsError('Aucun tool exposé par ce serveur.');
      }
      setToolsStatusMap((prev) => ({ ...prev, [server.id]: true }));
    } catch (err) {
      setToolsError(String(err));
      setToolsStatusMap((prev) => ({ ...prev, [server.id]: false }));
    } finally {
      setToolsLoading(false);
    }
  }

  const connectedIds = new Set(servers.map((s) => s.catalog_id).filter(Boolean));
  const popular = catalog.filter((c) => c.popular);
  const rest = catalog.filter((c) => !c.popular);
  const manageCatalog =
    manage?.catalog_id && catalog.find((c) => c.id === manage.catalog_id);
  const toolsHelp = manageCatalog?.tools_help || 'Liste distante JSON-RPC (tools/list).';
  const manageToolsOk = manage ? toolsStatusMap[manage.id] : undefined;
  const manageStatus = manage ? statusMeta(manage, manageToolsOk !== undefined, manageToolsOk) : null;
  const isOAuthRequired =
    manageCatalog?.auth_mode === 'oauth' &&
    toolsError &&
    (toolsError.includes('401') ||
      toolsError.includes('OAuth') ||
      toolsError.includes('could not parse jwt'));

  const isOAuthConnected = manage?.oauth_connected;

  async function startOAuth() {
    if (!manage) return;
    setBusy(true);
    try {
      const { auth_url } = await api.mcpOAuthStart(manage.id);
      // Ouvrir popup OAuth
      const popup = window.open(
        auth_url,
        'mcp_oauth',
        'width=600,height=700,popup=yes,scrollbars=yes',
      );
      if (!popup) {
        // Fallback: redirect en plein écran si popup bloquée
        toast.push({
          title: 'Popup bloquée, redirection…',
          tone: 'info',
        });
        window.location.assign(auth_url);
        return;
      }
      // Écouter message de succès depuis callback
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'mcp_oauth_success') {
          window.removeEventListener('message', handleMessage);
          toast.push({ title: 'OAuth connecté', tone: 'ok' });
          load();
          if (manage) openManage(manage);
        }
      };
      window.addEventListener('message', handleMessage);
    } catch (err) {
      toast.push({ title: 'OAuth KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function disconnectOAuth() {
    if (!manage) return;
    setBusy(true);
    try {
      await api.mcpOAuthDisconnect(manage.id);
      toast.push({ title: 'OAuth déconnecté', tone: 'info' });
      load();
      if (manage) openManage(manage);
    } catch (err) {
      toast.push({ title: 'Disconnect KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell active="mcp" title="MCP" description="Intégrations connectées à ton instance">
      {error && (
        <Alert tone="warn" class="mb-4">
          {error}
        </Alert>
      )}

      {loading ? (
        <HubGrid cols={5}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} class="aspect-square rounded-2xl" />
          ))}
        </HubGrid>
      ) : (
        <HubGrid cols={5}>
          {servers.map((s, i) => (
            <ServerCard
              key={s.id}
              server={s}
              index={i}
              onOpen={() => openManage(s)}
              toolsOk={toolsStatusMap[s.id]}
            />
          ))}
          <HubAddTile
            index={servers.length}
            label="Ajouter"
            onClick={() => setPickerOpen(true)}
          />
        </HubGrid>
      )}

      {!loading && !error && servers.length === 0 && (
        <p class="mt-6 text-center text-sm text-[var(--color-ink-muted)]">
          Aucune intégration pour l’instant. Ajoute-en une pour commencer.
        </p>
      )}

      {/* Catalogue — choisir une intégration */}
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Ajouter un MCP"
        description="Choisis une intégration à connecter"
        size="xl"
      >
        <div class="space-y-6">
          {popular.length > 0 && (
            <section>
              <h3 class="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                Populaires
              </h3>
              <HubGrid>
                {popular.map((p, i) => (
                  <CatalogPickCard
                    key={p.id}
                    item={p}
                    index={i}
                    alreadyConnected={connectedIds.has(p.id)}
                    onOpen={() => openPreset(p)}
                  />
                ))}
              </HubGrid>
            </section>
          )}
          {rest.length > 0 && (
            <section>
              <h3 class="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                Autres
              </h3>
              <HubGrid>
                {rest.map((p, i) => (
                  <CatalogPickCard
                    key={p.id}
                    item={p}
                    index={i}
                    alreadyConnected={connectedIds.has(p.id)}
                    onOpen={() => openPreset(p)}
                  />
                ))}
              </HubGrid>
            </section>
          )}
        </div>
      </Modal>

      {/* Configurer un preset */}
      <Modal
        open={!!preset}
        onClose={() => setPreset(null)}
        title={preset ? `Configurer ${preset.name}` : 'MCP'}
        description={preset?.description}
        size="lg"
        footer={
          preset ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPreset(null);
                  setPickerOpen(true);
                }}
              >
                Retour
              </Button>
              {/* Pour OAuth, on cache le bouton Connecter standard */}
              {preset.auth_mode !== 'oauth' && (
                <Button type="submit" form="mcp-preset-form" variant="secondary" disabled={busy}>
                  {busy ? 'Enregistrement…' : 'Connecter'}
                </Button>
              )}
            </>
          ) : null
        }
      >
        {preset && (
          <form id="mcp-preset-form" class="space-y-4" onSubmit={submit}>
            {/* Icône + catégorie */}
            <div class="mb-3 flex items-center gap-3">
              <McpIcon id={preset.id} name={preset.name} />
              <span class="text-sm text-[var(--color-ink-muted)]">{preset.category}</span>
            </div>

            {/* Intro courte si OAuth */}
            {preset.auth_mode === 'oauth' && preset.setup_intro && (
              <p class="text-xs text-[var(--color-ink-muted)]">{preset.setup_intro}</p>
            )}

            {/* CTA OAuth principal — uniquement pour auth_mode=oauth */}
            {preset.auth_mode === 'oauth' && (
              <Button
                type="button"
                variant="primary"
                class="w-full"
                disabled={busy}
                onClick={async () => {
                  try {
                    setBusy(true);
                    const minimal: Record<string, string> = {};
                    for (const f of preset.fields) {
                      if (f.key === 'url' && preset.default_url) {
                        minimal.url = preset.default_url;
                      } else if (!f.secret && fields[f.key]?.trim()) {
                        minimal[f.key] = fields[f.key];
                      } else {
                        minimal[f.key] = '';
                      }
                    }
                    const r = await api.mcpUpsert({
                      catalog_id: preset.id,
                      fields: minimal,
                    });
                    const serverId = r.data?.id;
                    if (!serverId) throw new Error('Server ID manquant');
                    const { auth_url } = await api.mcpOAuthStart(serverId);
                    const popup = window.open(
                      auth_url,
                      'mcp_oauth',
                      'width=600,height=700,popup=yes,scrollbars=yes',
                    );
                    if (!popup) {
                      toast.push({
                        title: 'Popup bloquée, redirection…',
                        tone: 'info',
                      });
                      window.location.assign(auth_url);
                      return;
                    }
                    const handleMessage = (event: MessageEvent) => {
                      if (event.data?.type === 'mcp_oauth_success') {
                        window.removeEventListener('message', handleMessage);
                        toast.push({ title: `${preset.name} connecté via OAuth`, tone: 'ok' });
                        setPreset(null);
                        load();
                      }
                    };
                    window.addEventListener('message', handleMessage);
                  } catch (err) {
                    toast.push({ title: 'OAuth KO', detail: String(err), tone: 'danger' });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Connexion OAuth…' : 'Se connecter avec OAuth'}
              </Button>
            )}

            {/* Accordéon « Avancé » pour OAuth presets */}
            {preset.auth_mode === 'oauth' && (
              <details class="group rounded-xl border border-[var(--color-line)] overflow-hidden">
                <summary class="cursor-pointer select-none bg-[var(--color-surface-raised)] px-4 py-3 text-sm font-medium text-[var(--color-ink)] flex items-center justify-between hover:bg-[var(--color-surface-hovered)] transition-colors">
                  <span>Avancé</span>
                  <svg
                    class="h-4 w-4 transition-transform group-open:rotate-180"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </summary>
                <div class="space-y-3 p-4">
                  <p class="text-xs text-[var(--color-ink-muted)]">
                    Configuration manuelle pour CI/CD ou personnalisation.
                  </p>
                  {(() => {
                    const nonSecretFields = preset.fields.filter((f) => !f.secret);
                    const secretFields = preset.fields.filter((f) => f.secret);
                    return (
                      <>
                        {nonSecretFields.map((f) => (
                          <div key={f.key}>
                            <Input
                              label={f.label}
                              type="text"
                              placeholder={f.placeholder || ''}
                              value={fields[f.key] || ''}
                              onInput={(e) =>
                                setFields((prev) => ({
                                  ...prev,
                                  [f.key]: (e.target as HTMLInputElement).value,
                                }))
                              }
                              required={f.required}
                            />
                            {f.help && (
                              <p class="mt-1 text-xs text-[var(--color-ink-faint)]">{f.help}</p>
                            )}
                          </div>
                        ))}
                        {secretFields.map((f) => (
                          <div key={f.key}>
                            <Input
                              label={f.label}
                              type="password"
                              placeholder={f.placeholder || ''}
                              value={fields[f.key] || ''}
                              onInput={(e) =>
                                setFields((prev) => ({
                                  ...prev,
                                  [f.key]: (e.target as HTMLInputElement).value,
                                }))
                              }
                              required={false}
                            />
                            {f.help && (
                              <p class="mt-1 text-xs text-[var(--color-ink-faint)]">{f.help}</p>
                            )}
                          </div>
                        ))}
                        <Button type="submit" variant="secondary" class="w-full" disabled={busy}>
                          {busy ? 'Enregistrement…' : 'Enregistrer sans OAuth'}
                        </Button>
                      </>
                    );
                  })()}
                  {preset.docs_url && (
                    <a
                      class="block text-xs text-[var(--color-accent)] underline"
                      href={preset.docs_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Documentation
                    </a>
                  )}
                </div>
              </details>
            )}

            {/* Pour non-OAuth : afficher tout normalement avec setup_intro/sections */}
            {preset.auth_mode !== 'oauth' && (
              <>
                {(preset.setup_intro ||
                  (preset.setup_sections && preset.setup_sections.length > 0)) && (
                  <Alert tone="info" class="space-y-0 text-xs leading-relaxed">
                    {preset.setup_intro && (
                      <p class="pb-2.5 text-[var(--color-ink-muted)]">{preset.setup_intro}</p>
                    )}
                    <div class="divide-y divide-[var(--color-border)]/60">
                      {preset.setup_sections?.map((sec) => (
                        <div key={sec.title} class="py-2.5 first:pt-0 last:pb-0">
                          <p class="font-medium text-[var(--color-ink)]">{sec.title}</p>
                          <p class="mt-0.5 whitespace-pre-wrap font-mono text-[11px] text-[var(--color-ink-muted)]">
                            {sec.body}
                          </p>
                        </div>
                      ))}
                    </div>
                  </Alert>
                )}
                {preset.fields.map((f) => (
                  <div key={f.key}>
                    <Input
                      label={f.label}
                      type={f.secret ? 'password' : 'text'}
                      placeholder={f.placeholder || ''}
                      value={fields[f.key] || ''}
                      onInput={(e) =>
                        setFields((prev) => ({
                          ...prev,
                          [f.key]: (e.target as HTMLInputElement).value,
                        }))
                      }
                      required={f.required}
                    />
                    {f.help && <p class="mt-1 text-xs text-[var(--color-ink-faint)]">{f.help}</p>}
                  </div>
                ))}
                {preset.docs_url && (
                  <a
                    class="block text-xs text-[var(--color-accent)] underline"
                    href={preset.docs_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Documentation
                  </a>
                )}
              </>
            )}
          </form>
        )}
      </Modal>

      {/* Gérer un MCP connecté */}
      <Modal
        open={!!manage}
        onClose={() => {
          setManage(null);
          setToolsError(null);
        }}
        title={manage?.name || 'MCP'}
        description={toolsHelp}
        size="lg"
        footer={
          manage ? (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => remove(manage.id)}
              >
                Retirer
              </Button>
              <Button type="button" variant="secondary" onClick={() => setManage(null)}>
                Fermer
              </Button>
            </>
          ) : null
        }
      >
        {manage && (
          <div class="space-y-4">
            <div class="flex items-center gap-3">
              <div class="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-[#2a2a2e]">
                <McpIcon id={manage.catalog_id || 'custom'} name={manage.name} size="lg" />
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge tone={manageStatus?.tone === 'ok' ? 'ok' : manageStatus?.tone === 'warn' ? 'warn' : 'neutral'}>
                    {manageStatus?.label}
                  </Badge>
                  {manage.meta?.org && <Badge tone="neutral">{manage.meta.org}</Badge>}
                </div>
                <p class="mt-1 truncate font-mono text-xs text-[var(--color-ink-faint)]">
                  {manage.url || 'API / secrets'}
                </p>
              </div>
            </div>

            {/* CTA proactif OAuth : info si auth_mode=oauth sans connexion */}
            {manageCatalog?.auth_mode === 'oauth' && !isOAuthConnected && !isOAuthRequired && (
              <Alert tone="info" class="text-xs">
                <p class="font-medium">Connexion OAuth disponible</p>
                <p class="mt-1 text-[var(--color-ink-muted)]">
                  Ce serveur MCP supporte OAuth. Connecte-toi pour activer tous les tools.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  class="mt-3"
                  disabled={busy}
                  onClick={startOAuth}
                >
                  {busy ? 'Connexion…' : 'Se connecter avec OAuth'}
                </Button>
              </Alert>
            )}

            {/* Warn si erreur 401/OAuth détectée */}
            {isOAuthRequired && !isOAuthConnected && (
              <Alert tone="warn" class="text-xs">
                <p class="font-medium">Authentification OAuth requise</p>
                <p class="mt-1 text-[var(--color-ink-muted)]">
                  Le serveur MCP {manage.name} hébergé exige OAuth pour accéder aux tools. Le token Platform API
                  permet uniquement de gérer les ressources (lier des bases de données).
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  class="mt-3"
                  disabled={busy}
                  onClick={startOAuth}
                >
                  {busy ? 'Connexion…' : 'Se connecter avec OAuth'}
                </Button>
              </Alert>
            )}

            {isOAuthConnected && (
              <Alert tone="ok" class="text-xs">
                <p class="font-medium">✓ OAuth connecté</p>
                <p class="mt-1 text-[var(--color-ink-muted)]">
                  Authentification OAuth active. Les tools MCP sont accessibles.
                </p>
                {manage.oauth_expires_at && (
                  <p class="mt-1 text-[10px] text-[var(--color-ink-faint)]">
                    Expire : {new Date(manage.oauth_expires_at).toLocaleString('fr-FR')}
                  </p>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  class="mt-2"
                  disabled={busy}
                  onClick={disconnectOAuth}
                >
                  Déconnecter OAuth
                </Button>
              </Alert>
            )}

            <section>
              <h3 class="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                Tools
              </h3>
              {!manage.url ? (
                <p class="text-sm text-[var(--color-ink-muted)]">
                  Ce connecteur n’expose pas d’URL tools/list (secrets API uniquement).
                </p>
              ) : toolsLoading ? (
                <p class="text-sm text-[var(--color-ink-muted)]">Chargement…</p>
              ) : toolsError ? (
                <Alert tone="warn">{toolsError}</Alert>
              ) : tools.length === 0 ? (
                <p class="text-sm text-[var(--color-ink-muted)]">Aucun tool exposé.</p>
              ) : (
                <ul class="max-h-64 space-y-2 overflow-y-auto text-sm">
                  {tools.map((t) => (
                    <li key={t.name} class="rounded-xl border border-[var(--color-line)] px-3 py-2">
                      <div class="font-mono text-xs">{t.name}</div>
                      <div class="mt-1 text-[var(--color-ink-muted)]">{t.description}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
