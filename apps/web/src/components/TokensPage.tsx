import { useEffect, useMemo, useState } from 'preact/hooks';
import { api } from '../lib/api';
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

export function TokensPage() {
  const toast = useToast();
  const [items, setItems] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [wantWrite, setWantWrite] = useState(true);
  const [expiresDays, setExpiresDays] = useState('');
  const [createdPlain, setCreatedPlain] = useState<string | null>(null);
  const [instanceUrl, setInstanceUrl] = useState('');

  const mcpUrl = useMemo(() => {
    const base = (instanceUrl || (typeof window !== 'undefined' ? window.location.origin : ''))
      .replace(/\/$/, '');
    return `${base}/api/v1/mcp`;
  }, [instanceUrl]);

  async function load() {
    const r = await api.listTokens();
    setItems(r.data ?? []);
  }

  useEffect(() => {
    Promise.all([api.listTokens(), api.bootstrap()])
      .then(([t, b]) => {
        setItems(t.data ?? []);
        setInstanceUrl(b.settings?.instance_url || '');
      })
      .catch((e) => toast.push({ title: 'Tokens KO', detail: String(e), tone: 'danger' }))
      .finally(() => setLoading(false));
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
      <FadeIn>
        <div class="space-y-4">
          <Card>
            <CardHeader
              title="Nouveau token"
              description="Le secret n’est affiché qu’une fois. Préfixe dfat_."
            />
            <form class="space-y-3" onSubmit={create}>
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
              <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                Créer
              </Button>
            </form>
          </Card>

          <Card>
            <CardHeader title="Tes tokens" />
            {loading ? (
              <Skeleton class="h-24" />
            ) : (
              <ul class="divide-y divide-[var(--color-line)]">
                {items.map((t) => (
                  <li key={t.id} class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <div>
                      <div class="font-medium">{t.name}</div>
                      <div class="mt-1 flex flex-wrap gap-1.5 text-xs text-[var(--color-ink-muted)]">
                        <code>{t.token_prefix}…</code>
                        {t.abilities.map((a) => (
                          <Badge key={a} tone={a === 'write' ? 'accent' : 'neutral'}>
                            {a}
                          </Badge>
                        ))}
                      </div>
                      <div class="mt-1 text-xs text-[var(--color-ink-faint)]">
                        Créé {formatWhen(t.created_at)}
                        {t.last_used_at ? ` · utiliséé ${formatWhen(t.last_used_at)}` : ''}
                        {t.expires_at ? ` · Expire ${formatWhen(t.expires_at)}` : ''}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => revoke(t.id)}>
                      Révoquer
                    </Button>
                  </li>
                ))}
                {items.length === 0 && (
                  <li class="py-2 text-sm text-[var(--color-ink-muted)]">Aucun token.</li>
                )}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Connexion MCP (Cursor)"
              description={`Endpoint JSON-RPC : ${mcpUrl}`}
            />
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
          </Card>
        </div>
      </FadeIn>

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
