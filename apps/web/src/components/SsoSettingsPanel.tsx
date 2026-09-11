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
  Skeleton,
  useToast,
} from './ui';

type SsoConfig = {
  protect_apps_by_default: boolean;
  forward_auth_address: string;
  hide_local_login: boolean;
  pocket_id_url: string;
  oauth2_proxy_url: string;
  apps_client_id: string;
  apps_client_secret_set: boolean;
  forward_auth_configured: boolean;
  oidc_configured: boolean;
  middleware_name: string;
};

export function SsoSettingsPanel({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<SsoConfig | null>(null);

  const [pocketIdUrl, setPocketIdUrl] = useState('');
  const [forwardAuth, setForwardAuth] = useState('');
  const [oauth2ProxyUrl, setOauth2ProxyUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [protectDefault, setProtectDefault] = useState(true);
  const [hideLocal, setHideLocal] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.ssoGet();
      setCfg(r.config);
      setPocketIdUrl(r.config.pocket_id_url || '');
      setForwardAuth(r.config.forward_auth_address || '');
      setOauth2ProxyUrl(r.config.oauth2_proxy_url || '');
      setClientId(r.config.apps_client_id || '');
      setProtectDefault(!!r.config.protect_apps_by_default);
      setHideLocal(!!r.config.hide_local_login);
      setClientSecret('');
    } catch (e) {
      toast.push({ title: 'Chargement SSO KO', detail: String(e), tone: 'danger' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin]);

  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.ssoSave({
        pocket_id_url: pocketIdUrl.trim(),
        forward_auth_address: forwardAuth.trim(),
        oauth2_proxy_url: oauth2ProxyUrl.trim(),
        apps_client_id: clientId.trim(),
        ...(clientSecret.trim() ? { apps_client_secret: clientSecret.trim() } : {}),
        protect_apps_by_default: protectDefault,
        hide_local_login: hideLocal,
      });
      setCfg(r.config);
      setClientSecret('');
      toast.push({ title: 'SSO enregistré', tone: 'ok' });
    } catch (err) {
      toast.push({ title: 'Save SSO KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <FadeIn>
        <Alert tone="warn">Réservé aux admins instance.</Alert>
      </FadeIn>
    );
  }

  if (loading) {
    return (
      <FadeIn>
        <Skeleton class="h-40" />
      </FadeIn>
    );
  }

  return (
    <FadeIn>
      <div class="space-y-4">
        <Card>
          <CardHeader
            title="OIDC / Pocket ID"
            description="IdP externe déjà déployé. DevForge injecte les env OIDC et attache le ForwardAuth Traefik."
            action={
              <div class="flex flex-wrap gap-2">
                <Badge tone={cfg?.oidc_configured ? 'ok' : 'muted'}>
                  OIDC {cfg?.oidc_configured ? 'OK' : 'incomplet'}
                </Badge>
                <Badge tone={cfg?.forward_auth_configured ? 'ok' : 'muted'}>
                  ForwardAuth {cfg?.forward_auth_configured ? 'OK' : 'off'}
                </Badge>
              </div>
            }
          />
          <form class="grid gap-3 md:grid-cols-2" onSubmit={save}>
            <div class="md:col-span-2">
              <Input
                label="URL Pocket ID (issuer)"
                placeholder="https://id.example.com"
                value={pocketIdUrl}
                onInput={(e) => setPocketIdUrl((e.target as HTMLInputElement).value)}
              />
            </div>
            <Input
              label="Client ID (apps)"
              placeholder="devforge-apps"
              value={clientId}
              onInput={(e) => setClientId((e.target as HTMLInputElement).value)}
            />
            <Input
              label={
                cfg?.apps_client_secret_set
                  ? 'Client secret (laisser vide pour garder)'
                  : 'Client secret'
              }
              type="password"
              autocomplete="new-password"
              value={clientSecret}
              onInput={(e) => setClientSecret((e.target as HTMLInputElement).value)}
            />
            <div class="md:col-span-2">
              <Input
                label="ForwardAuth address (oauth2-proxy / TinyAuth)"
                placeholder="http://oauth2-proxy:4180/"
                value={forwardAuth}
                onInput={(e) => setForwardAuth((e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="md:col-span-2">
              <Input
                label="URL publique oauth2-proxy (optionnel)"
                placeholder="https://sso.example.com"
                value={oauth2ProxyUrl}
                onInput={(e) => setOauth2ProxyUrl((e.target as HTMLInputElement).value)}
              />
            </div>
            <label class="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={protectDefault}
                onChange={(e) => setProtectDefault((e.target as HTMLInputElement).checked)}
              />
              Protéger par défaut les apps sans login propre
            </label>
            <label class="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={hideLocal}
                onChange={(e) => setHideLocal((e.target as HTMLInputElement).checked)}
              />
              Masquer le login local DevForge (réglage réservé — login plateforme OIDC à venir)
            </label>
            <div class="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={busy}>
                {busy ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        </Card>
        <Alert tone="info">
          Middleware Traefik : <code>{cfg?.middleware_name || 'devforge-sso-auth'}</code>. Le
          conteneur oauth2-proxy doit être joignable depuis Traefik (même réseau Docker). Sur chaque
          projet : Settings → SSO.
        </Alert>
      </div>
    </FadeIn>
  );
}
