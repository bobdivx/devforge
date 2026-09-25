import { useEffect, useMemo, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { AppShell } from './AppShell';
import {
  Alert,
  Badge,
  Button,
  HubAddTile,
  HubGrid,
  HubIcon,
  HubTile,
  Input,
  Modal,
  Skeleton,
  useToast,
} from './ui';

type TokenRow = {
  id: string;
  name: string;
  token_prefix: string;
  abilities: string[];
  last_used_at?: string | null;
  expires_at?: string | null;
  created_at: string;
};

function formatWhen(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function tokenStatus(t: TokenRow): { label: string; tone: 'ok' | 'warn' | 'neutral' } {
  if (t.expires_at) {
    const exp = new Date(t.expires_at).getTime();
    if (!Number.isNaN(exp) && exp < Date.now()) {
      return { label: 'Expiré', tone: 'warn' };
    }
  }
  if (t.last_used_at) return { label: 'Utilisé', tone: 'ok' };
  return { label: 'Inactif', tone: 'neutral' };
}

function statusDotClass(tone: 'ok' | 'warn' | 'neutral') {
  if (tone === 'ok') return 'bg-[var(--color-ok)]';
  if (tone === 'warn') return 'bg-[var(--color-warn)]';
  return 'bg-[var(--color-ink-faint)]';
}

type GrantRow = {
  id: string;
  client_id: string;
  client_name: string;
  created_at: string;
  last_used_at?: string | null;
};

export function TokensPage() {
  const toast = useToast();
  const [items, setItems] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [manage, setManage] = useState<TokenRow | null>(null);
  const [name, setName] = useState('');
  const [wantWrite, setWantWrite] = useState(true);
  const [expiresDays, setExpiresDays] = useState('');
  const [createdPlain, setCreatedPlain] = useState<string | null>(null);
  const [instanceUrl, setInstanceUrl] = useState('');
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [grant, setGrant] = useState<GrantRow | null>(null);

  const mcpUrl = useMemo(() => {
    const base = (instanceUrl || (typeof window !== 'undefined' ? window.location.origin : ''))
      .replace(/\/$/, '');
    return `${base}/api/v1/mcp`;
  }, [instanceUrl]);

  async function load() {
    const r = await api.listTokens();
    setItems(r.data ?? []);
  }

  async function loadGrants() {
    try {
      const g = await api.oauthGrants();
      setGrants(g.data ?? []);
    } catch {
      setGrants([]);
    }
  }

  async function revokeGrant(id: string) {
    if (!confirm('Déconnecter cette application ? Elle devra redemander l’autorisation.')) return;
    setBusy(true);
    try {
      await api.oauthRevokeGrant(id);
      toast.push({ title: 'Application déconnectée', tone: 'info' });
      setGrant(null);
      await loadGrants();
    } catch (err) {
      toast.push({ title: 'Déconnexion KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    Promise.all([api.listTokens(), api.bootstrap()])
      .then(([t, b]) => {
        setItems(t.data ?? []);
        setInstanceUrl(b.settings?.instance_url || '');
      })
      .catch((e) => toast.push({ title: 'Tokens KO', detail: String(e), tone: 'danger' }))
      .finally(() => setLoading(false));
    void loadGrants();
  }, []);

  async function create(e: Event) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const abilities = wantWrite ? ['read', 'write'] : ['read'];
      const days = expiresDays.trim() ? Number(expiresDays) : undefined;
      const r = await api.createToken({
        name: name.trim(),
        abilities,
        expires_in_days: days && days > 0 ? days : null,
      });
      setCreatedPlain(r.data.token);
      setName('');
      setExpiresDays('');
      setCreateOpen(false);
      toast.push({ title: 'Token créé', detail: 'Copie-le maintenant', tone: 'ok' });
      await load();
    } catch (err) {
      toast.push({ title: 'Création KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Révoquer ce token ? Les clients MCP qui l’utilisent cesseront de fonctionner.')) {
      return;
    }
    setBusy(true);
    try {
      await api.revokeToken(id);
      toast.push({ title: 'Token révoqué', tone: 'info' });
      setManage(null);
      await load();
    } catch (err) {
      toast.push({ title: 'Révocation KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.push({ title: 'Copié', tone: 'ok' });
    } catch {
      toast.push({ title: 'Copie manuelle', detail: text, tone: 'warn' });
    }
  }

  const cursorSnippet = createdPlain
    ? `{
  "mcpServers": {
    "devforge": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${createdPlain}"
      }
    }
  }
}`
    : `{
  "mcpServers": {
    "devforge": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer dfat_…"
      }
    }
  }
}`;

  return (
    <AppShell
      active="tokens"
      title="Tokens API"
      description="Tokens personnels pour MCP / API (Cursor, scripts…)."
    >
      {loading ? (
        <HubGrid cols={5}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} class="aspect-square rounded-2xl" />
          ))}
        </HubGrid>
      ) : (
        <HubGrid cols={5}>
          {items.map((t, i) => {
            const status = tokenStatus(t);
            return (
              <HubTile
                key={t.id}
                index={i}
                title={t.name}
                onClick={() => setManage(t)}
                icon={<HubIcon name="key" />}
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
                    <div class="truncate font-mono text-[10px] text-[var(--color-ink-faint)]">
                      {t.token_prefix}…
                    </div>
                  </div>
                }
              />
            );
          })}
          <HubAddTile
            index={items.length}
            label="Ajouter"
            onClick={() => setCreateOpen(true)}
          />
        </HubGrid>
      )}

      {!loading && items.length === 0 && (
        <p class="mt-6 text-center text-sm text-[var(--color-ink-muted)]">
          Aucun token. Crée-en un pour connecter Cursor / MCP.
        </p>
      )}

      {grants.length > 0 && (
        <div class="mt-8">
          <h2 class="mb-3 text-sm font-medium tracking-tight">Applications connectées</h2>
          <HubGrid cols={5}>
            {grants.map((g, i) => (
              <HubTile
                key={g.id}
                index={i}
                title={g.client_name || 'Application'}
                onClick={() => setGrant(g)}
                icon={<HubIcon name="key" />}
                badge={
                  <span
                    class="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-[var(--color-ok)] ring-2 ring-[#1c1c1e]"
                    title="Connectée"
                    aria-hidden
                  />
                }
                subtitle={
                  <div class="mt-1 text-[11px] font-medium text-[var(--color-ok)]">Connectée</div>
                }
              />
            ))}
          </HubGrid>
        </div>
      )}

      <div class="mt-8">
        <h2 class="mb-2 text-sm font-medium tracking-tight">Connecteur Grok / applications OAuth</h2>
        <p class="mb-3 text-sm text-[var(--color-ink-muted)]">
          Dans Grok (Connecteurs → Nouveau → Personnalisé), colle l’URL{' '}
          <code class="text-xs">{mcpUrl}</code>. La connexion passe par ton compte DevForge : aucun
          token à copier, laisse Client ID / Secret vides.
        </p>
        <Button size="sm" variant="outline" onClick={() => copy(mcpUrl)}>
          Copier l’URL MCP
        </Button>
      </div>

      <div class="mt-8">
        <h2 class="mb-2 text-sm font-medium tracking-tight">Connexion MCP (Cursor)</h2>
        <p class="mb-3 text-sm text-[var(--color-ink-muted)]">
          Endpoint JSON-RPC : <code class="text-xs">{mcpUrl}</code>
        </p>
        <Alert tone="info" class="mb-3">
          Colle ce bloc dans <code class="text-xs">.cursor/mcp.json</code> (ou Settings → MCP).
          Remplace le Bearer par ton token <code class="text-xs">dfat_…</code>.
        </Alert>
        <pre class="overflow-x-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-xs">
          {cursorSnippet}
        </pre>
        <div class="mt-3">
          <Button size="sm" variant="outline" onClick={() => copy(cursorSnippet)}>
            Copier le snippet
          </Button>
        </div>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nouveau token"
        description="Le secret n’est affiché qu’une fois. Préfixe dfat_."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              form="token-create-form"
              variant="secondary"
              disabled={busy || !name.trim()}
            >
              Créer
            </Button>
          </>
        }
      >
        <form id="token-create-form" class="space-y-3" onSubmit={create}>
          <Input
            label="Nom"
            placeholder="Cursor laptop"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <label class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
            <input
              type="checkbox"
              checked={wantWrite}
              onChange={(e) => setWantWrite((e.target as HTMLInputElement).checked)}
            />
            Inclure <code class="text-xs">write</code> (déplois, tools/call) — sinon lecture seule
          </label>
          <Input
            label="Expiration (jours, optionnel)"
            type="number"
            placeholder="Illimité"
            value={expiresDays}
            onInput={(e) => setExpiresDays((e.target as HTMLInputElement).value)}
          />
        </form>
      </Modal>

      <Modal
        open={!!manage}
        onClose={() => setManage(null)}
        title={manage?.name || 'Token'}
        description={manage ? `${manage.token_prefix}…` : undefined}
        footer={
          manage ? (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => void revoke(manage.id)}
              >
                Révoquer
              </Button>
              <Button type="button" variant="secondary" onClick={() => setManage(null)}>
                Fermer
              </Button>
            </>
          ) : null
        }
      >
        {manage && (
          <dl class="space-y-3 text-sm">
            <div class="flex flex-wrap gap-1.5">
              {manage.abilities.map((a) => (
                <Badge key={a} tone={a === 'write' ? 'accent' : 'neutral'}>
                  {a}
                </Badge>
              ))}
              <Badge tone={tokenStatus(manage).tone === 'ok' ? 'ok' : tokenStatus(manage).tone === 'warn' ? 'warn' : 'neutral'}>
                {tokenStatus(manage).label}
              </Badge>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-[var(--color-ink-muted)]">Créé</dt>
              <dd>{formatWhen(manage.created_at)}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-[var(--color-ink-muted)]">Dernier usage</dt>
              <dd>{formatWhen(manage.last_used_at)}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-[var(--color-ink-muted)]">Expiration</dt>
              <dd>{manage.expires_at ? formatWhen(manage.expires_at) : 'Illimité'}</dd>
            </div>
          </dl>
        )}
      </Modal>

      <Modal
        open={!!grant}
        onClose={() => setGrant(null)}
        title={grant?.client_name || 'Application'}
        description="Accès OAuth au MCP DevForge"
        footer={
          grant ? (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => void revokeGrant(grant.id)}
              >
                Déconnecter
              </Button>
              <Button type="button" variant="secondary" onClick={() => setGrant(null)}>
                Fermer
              </Button>
            </>
          ) : null
        }
      >
        {grant && (
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-[var(--color-ink-muted)]">Client</dt>
              <dd class="truncate font-mono text-xs">{grant.client_id}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-[var(--color-ink-muted)]">Autorisée</dt>
              <dd>{formatWhen(grant.created_at)}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-[var(--color-ink-muted)]">Dernier usage</dt>
              <dd>{formatWhen(grant.last_used_at)}</dd>
            </div>
          </dl>
        )}
      </Modal>

      <Modal
        open={!!createdPlain}
        onClose={() => setCreatedPlain(null)}
        title="Token créé"
        description="Copie-le maintenant — il ne sera plus réaffiché."
        footer={
          <>
            <Button size="sm" onClick={() => createdPlain && copy(createdPlain)}>
              Copier le token
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCreatedPlain(null)}>
              Fermer
            </Button>
          </>
        }
      >
        {createdPlain && (
          <code class="block break-all rounded-xl border border-[var(--color-line)] p-3 text-xs">
            {createdPlain}
          </code>
        )}
      </Modal>
    </AppShell>
  );
}
