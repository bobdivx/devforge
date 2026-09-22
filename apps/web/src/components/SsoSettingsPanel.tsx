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

type OidcProvider = 'generic' | 'pocket_id';

type SsoConfig = {
  provider: OidcProvider | string;
  issuer_url: string;
  protect_apps_by_default: boolean;
  forward_auth_address: string;
  hide_local_login: boolean;
  enable_platform_login: boolean;
  pocket_id_url: string;
  oauth2_proxy_url: string;
  apps_client_id: string;
  apps_client_secret_set: boolean;
  pocket_id_api_token_set: boolean;
  forward_auth_configured: boolean;
  oidc_configured: boolean;
  middleware_name: string;
};

export function SsoSettingsPanel({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<SsoConfig | null>(null);
  const [showProxy, setShowProxy] = useState(false);

  const [provider, setProvider] = useState<OidcProvider>('generic');
  const [issuerUrl, setIssuerUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [forwardAuth, setForwardAuth] = useState('');
  const [oauth2ProxyUrl, setOauth2ProxyUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [protectDefault, setProtectDefault] = useState(true);
  const [hideLocal, setHideLocal] = useState(false);
  const [enablePlatform, setEnablePlatform] = useState(false);
  const [rotateSecret, setRotateSecret] = useState(false);
  const [logoUrl, setLogoUrl] = useState('');
  const [backgroundUrl, setBackgroundUrl] = useState('');
  const [showBranding, setShowBranding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.ssoGet();
      setCfg(r.config);
      const p = r.config.provider === 'pocket_id' ? 'pocket_id' : 'generic';
      setProvider(p);
      setIssuerUrl(r.config.issuer_url || r.config.pocket_id_url || '');
      setForwardAuth(r.config.forward_auth_address || '');
      setOauth2ProxyUrl(r.config.oauth2_proxy_url || '');
      setClientId(r.config.apps_client_id || '');
      setProtectDefault(!!r.config.protect_apps_by_default);
      setHideLocal(!!r.config.hide_local_login);
      setEnablePlatform(!!r.config.enable_platform_login);
      setApiToken('');
      setClientSecret('');
      setRotateSecret(false);
      setLogoUrl('');
      setBackgroundUrl('');
      setShowProxy(!!(r.config.forward_auth_address || r.config.oauth2_proxy_url));
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
      const isPocket = provider === 'pocket_id';
      const hasToken = !!apiToken.trim() || !!cfg?.pocket_id_api_token_set;
      const r = await api.ssoSave({
        provider,
        issuer_url: issuerUrl.trim(),
        pocket_id_url: issuerUrl.trim(),
        ...(isPocket && apiToken.trim() ? { pocket_id_api_token: apiToken.trim() } : {}),
        forward_auth_address: forwardAuth.trim(),
        oauth2_proxy_url: oauth2ProxyUrl.trim(),
        apps_client_id: clientId.trim(),
        ...(clientSecret.trim() ? { apps_client_secret: clientSecret.trim() } : {}),
        protect_apps_by_default: protectDefault,
        hide_local_login: hideLocal,
        enable_platform_login: isPocket || enablePlatform,
        provision: isPocket && hasToken && !!issuerUrl.trim(),
        rotate_secret: isPocket && rotateSecret,
        ...(isPocket && logoUrl.trim() ? { logo_url: logoUrl.trim() } : {}),
        ...(isPocket && backgroundUrl.trim() ? { background_url: backgroundUrl.trim() } : {}),
      });
      setCfg(r.config);
      setApiToken('');
      setClientSecret('');
      setRotateSecret(false);
      setBackgroundUrl('');
      const p = r.provision;
      if (p && typeof p === 'object' && p.ok) {
        const bits = [
          p.created_client ? 'client créé' : 'client à jour',
          p.created_secret ? 'secret généré' : null,
          p.logo_set ? 'logo poussé' : null,
          p.background_set ? 'fond poussé' : null,
        ].filter(Boolean);
        const warn = Array.isArray(p.branding_warnings) ? p.branding_warnings.filter(Boolean) : [];
        toast.push({
          title: 'Pocket ID connecté',
          detail: [...bits, ...warn].join(' · ') || undefined,
          tone: warn.length ? 'warn' : 'ok',
        });
      } else {
        toast.push({ title: 'SSO enregistré', tone: 'ok' });
      }
    } catch (err) {
      toast.push({ title: 'SSO KO', detail: String(err), tone: 'danger' });
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

  const isPocket = provider === 'pocket_id';

  return (
    <FadeIn>
      <div class="space-y-4">
        <Card>
          <CardHeader
            title="SSO / OIDC"
            description="Branche n’importe quel IdP OIDC. Pocket ID est un raccourci qui provisionne le client automatiquement."
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
          <form class="grid gap-3" onSubmit={save}>
            <fieldset class="grid gap-2">
              <legend class="text-sm font-medium">Fournisseur</legend>
              <div class="flex flex-wrap gap-4 text-sm">
                <label class="flex items-center gap-2">
                  <input
                    type="radio"
                    name="oidc-provider"
                    checked={provider === 'generic'}
                    onChange={() => setProvider('generic')}
                  />
                  OIDC générique
                </label>
                <label class="flex items-center gap-2">
                  <input
                    type="radio"
                    name="oidc-provider"
                    checked={provider === 'pocket_id'}
                    onChange={() => setProvider('pocket_id')}
                  />
                  Pocket ID
                </label>
              </div>
            </fieldset>

            <Input
              label={isPocket ? 'URL Pocket ID (issuer)' : 'URL issuer OIDC'}
              placeholder="https://id.example.com"
              value={issuerUrl}
              onInput={(e) => setIssuerUrl((e.target as HTMLInputElement).value)}
            />

            {isPocket ? (
              <>
                <Input
                  label={
                    cfg?.pocket_id_api_token_set
                      ? 'Clé API Pocket ID (laisser vide pour garder)'
                      : 'Clé API Pocket ID'
                  }
                  type="password"
                  autocomplete="new-password"
                  placeholder="Administration → Clés d’API"
                  value={apiToken}
                  onInput={(e) => setApiToken((e.target as HTMLInputElement).value)}
                />
                {cfg?.apps_client_id ? (
                  <p class="text-sm text-[var(--muted)]">
                    Client OIDC : <code>{cfg.apps_client_id}</code>
                    {cfg.apps_client_secret_set ? ' · secret enregistré' : ''}
                  </p>
                ) : null}
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={rotateSecret}
                    onChange={(e) => setRotateSecret((e.target as HTMLInputElement).checked)}
                    disabled={!cfg?.pocket_id_api_token_set && !apiToken.trim()}
                  />
                  Régénérer le client secret
                </label>
                <button
                  type="button"
                  class="justify-self-start text-sm text-[var(--muted)] underline-offset-2 hover:underline"
                  onClick={() => setShowBranding((v) => !v)}
                >
                  {showBranding ? 'Masquer branding Pocket ID' : 'Branding Pocket ID (logo / fond)'}
                </button>
                {showBranding && (
                  <div class="grid gap-3 border-t border-[var(--border)] pt-3">
                    <Input
                      label="Logo client OIDC (URL, optionnel)"
                      placeholder="Par défaut : {URL instance}/favicon.svg"
                      value={logoUrl}
                      onInput={(e) => setLogoUrl((e.target as HTMLInputElement).value)}
                    />
                    <Input
                      label="Image de fond login Pocket ID (URL)"
                      placeholder="https://cdn.example.com/bg.jpg"
                      value={backgroundUrl}
                      onInput={(e) => setBackgroundUrl((e.target as HTMLInputElement).value)}
                    />
                    <p class="text-xs text-[var(--muted)]">
                      Le logo est poussé sur le client OIDC DevForge. Le fond s’applique à l’écran de
                      login Pocket ID (instance entière). Pocket ID doit pouvoir télécharger ces URLs.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div class="grid gap-3 md:grid-cols-2">
                <Input
                  label="Client ID"
                  placeholder="devforge"
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
              </div>
            )}

            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={protectDefault}
                onChange={(e) => setProtectDefault((e.target as HTMLInputElement).checked)}
              />
              Protéger par défaut les apps sans login propre
            </label>

            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPocket || enablePlatform}
                disabled={isPocket}
                onChange={(e) => setEnablePlatform((e.target as HTMLInputElement).checked)}
              />
              {isPocket
                ? 'Les comptes Pocket ID peuvent se connecter à DevForge'
                : 'Activer la connexion SSO à DevForge (se connecter à DevForge lui-même via OIDC)'}
            </label>

            <button
              type="button"
              class="justify-self-start text-sm text-[var(--muted)] underline-offset-2 hover:underline"
              onClick={() => setShowProxy((v) => !v)}
            >
              {showProxy ? 'Masquer ForwardAuth / Traefik' : 'ForwardAuth / Traefik (optionnel)'}
            </button>

            {showProxy && (
              <div class="grid gap-3 border-t border-[var(--border)] pt-3">
                <Input
                  label="ForwardAuth address (oauth2-proxy / TinyAuth)"
                  placeholder="http://oauth2-proxy:4180/"
                  value={forwardAuth}
                  onInput={(e) => setForwardAuth((e.target as HTMLInputElement).value)}
                />
                <Input
                  label="URL publique oauth2-proxy (optionnel)"
                  placeholder="https://sso.example.com"
                  value={oauth2ProxyUrl}
                  onInput={(e) => setOauth2ProxyUrl((e.target as HTMLInputElement).value)}
                />
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={hideLocal}
                    onChange={(e) => setHideLocal((e.target as HTMLInputElement).checked)}
                    disabled={!(isPocket || enablePlatform)}
                  />
                  Masquer le login local DevForge (uniquement si le SSO plateforme est activé)
                </label>
                {(isPocket || enablePlatform) && hideLocal && (
                  <p class="text-xs text-[var(--color-accent)]">
                    ⚠️ Le login par email/password sera masqué. Assure-toi que le SSO fonctionne avant !
                  </p>
                )}
              </div>
            )}

            <div class="flex justify-end">
              <Button type="submit" disabled={busy}>
                {busy
                  ? 'Enregistrement…'
                  : isPocket && !cfg?.oidc_configured
                    ? 'Connecter Pocket ID'
                    : 'Enregistrer'}
              </Button>
            </div>
          </form>
        </Card>
        <Alert tone="info">
          {isPocket
            ? 'Pocket ID : une clé API admin crée le client OIDC automatiquement (logo DevForge inclus).'
            : 'OIDC générique : authentik, Keycloak, Authelia, Zitadel, etc. — saisis issuer + client ID/secret.'}{' '}
          Middleware Traefik : <code>{cfg?.middleware_name || 'devforge-sso-auth'}</code>. Sur chaque
          projet : Settings → SSO.
        </Alert>
      </div>
    </FadeIn>
  );
}
