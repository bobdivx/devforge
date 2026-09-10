import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { AppShell } from './AppShell';
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

function McpIcon({ id, name, size = 'md' }: { id: string; name: string; size?: 'sm' | 'md' }) {
  const candidates = iconCandidates(id);
  const [idx, setIdx] = useState(0);
  const src = candidates[idx];
  const dim = size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl';

  useEffect(() => {
    setIdx(0);
  }, [id]);

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
          key={src}
          src={src}
          alt=""
          class="h-full w-full object-contain p-1.5"
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

function CatalogCard({
  item,
  connected,
  onOpen,
}: {
  item: CatalogItem;
  connected: boolean;
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
      <McpIcon id={item.id} name={item.name} />
      <div class="min-w-0 flex-1">
        <div class="truncate font-medium tracking-tight">{item.name}</div>
        <div class="mt-0.5 text-xs text-[var(--color-ink-faint)]">{item.category}</div>
      </div>
      {connected ? (
        <Badge tone="ok" class="shrink-0">
          connecté
        </Badge>
      ) : (
        <span class="shrink-0 text-xs text-[var(--color-ink-faint)] opacity-0 transition group-hover:opacity-100">
          Configurer
        </span>
      )}
    </button>
  );
}

export function McpPage() {
  const toast = useToast();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<CatalogItem | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [toolsFor, setToolsFor] = useState<string | null>(null);
  const [tools, setTools] = useState<Array<{ name: string; description: string }>>([]);

  async function load() {
    try {
      const [c, s] = await Promise.all([api.mcpCatalog(), api.mcpServers()]);
      setCatalog(c.data ?? []);
      setServers(s.data ?? []);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openPreset(p: CatalogItem) {
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
      await load();
    } catch (err) {
      toast.push({ title: 'Delete KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function showTools(id: string) {
    setToolsFor(id);
    setTools([]);
    try {
      const r = await api.mcpTools(id);
      setTools(r.data ?? []);
    } catch (err) {
      toast.push({ title: 'Tools KO', detail: String(err), tone: 'warn' });
    }
  }

  const popular = catalog.filter((c) => c.popular);
  const rest = catalog.filter((c) => !c.popular);
  const connectedIds = new Set(servers.map((s) => s.catalog_id).filter(Boolean));

  return (
    <AppShell active="mcp" title="MCP" description="Connecte Turso, Slack, GitHub…">
      {error && (
        <Alert tone="warn" class="mb-4">
          {error}
        </Alert>
      )}

      <FadeIn>
        <section class="mb-8">
          <h2 class="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
            Populaires
          </h2>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {popular.map((p) => (
              <CatalogCard
                key={p.id}
                item={p}
                connected={connectedIds.has(p.id)}
                onOpen={() => openPreset(p)}
              />
            ))}
          </div>
        </section>
      </FadeIn>

      <FadeIn delay={40}>
        <section class="mb-8">
          <h2 class="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
            Autres
          </h2>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((p) => (
              <CatalogCard
                key={p.id}
                item={p}
                connected={connectedIds.has(p.id)}
                onOpen={() => openPreset(p)}
              />
            ))}
          </div>
        </section>
      </FadeIn>

      <FadeIn delay={80}>
        <Card>
          <CardHeader title="Connectés" />
          {servers.length === 0 ? (
            <p class="text-sm text-[var(--color-ink-muted)]">Aucune intégration pour l’instant.</p>
          ) : (
            <ul class="divide-y divide-[var(--color-line)]">
              {servers.map((s) => (
                <li key={s.id} class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div class="flex min-w-0 items-center gap-3">
                    <McpIcon id={s.catalog_id || 'custom'} name={s.name} size="sm" />
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="truncate font-medium">{s.name}</span>
                        {!s.enabled && <Badge tone="warn">off</Badge>}
                      </div>
                      <div class="mt-0.5 truncate font-mono text-xs text-[var(--color-ink-faint)]">
                        {s.url || 'API / secrets'}
                        {s.meta?.org ? ` · ${s.meta.org}` : ''}
                      </div>
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    {s.url && (
                      <Button size="sm" variant="outline" onClick={() => showTools(s.id)}>
                        Tools
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => remove(s.id)}
                    >
                      Retirer
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </FadeIn>

      <Modal
        open={!!preset}
        onClose={() => setPreset(null)}
        title={preset ? `Configurer ${preset.name}` : 'MCP'}
        description={preset?.description}
        size="md"
      >
        {preset && (
          <form class="space-y-3" onSubmit={submit}>
            <div class="mb-1 flex items-center gap-3">
              <McpIcon id={preset.id} name={preset.name} />
              <span class="text-sm text-[var(--color-ink-muted)]">{preset.category}</span>
            </div>
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
                {f.help && (
                  <p class="mt-1 text-xs text-[var(--color-ink-faint)]">{f.help}</p>
                )}
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
            <div class="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setPreset(null)}>
                Annuler
              </Button>
              <Button type="submit" variant="secondary" disabled={busy}>
                {busy ? 'Enregistrement…' : 'Connecter'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={!!toolsFor}
        onClose={() => setToolsFor(null)}
        title="Tools MCP"
        description="Liste distante (échec si l’URL MCP n’est pas joignable)."
        size="lg"
      >
        {tools.length === 0 ? (
          <p class="text-sm text-[var(--color-ink-muted)]">Aucun tool ou endpoint injoignable.</p>
        ) : (
          <ul class="space-y-2 text-sm">
            {tools.map((t) => (
              <li key={t.name} class="rounded-xl border border-[var(--color-line)] px-3 py-2">
                <div class="font-mono text-xs">{t.name}</div>
                <div class="mt-1 text-[var(--color-ink-muted)]">{t.description}</div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </AppShell>
  );
}
