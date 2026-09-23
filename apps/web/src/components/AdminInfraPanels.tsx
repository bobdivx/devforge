import { useEffect, useState } from 'preact/hooks';
import { api, type DnsRuntimeStatus, type DnsSettingsPublic } from '../lib/api';
import { DnsEntrypointPanel } from './DnsEntrypointPanel';
import { DockerEngineAlert } from './DockerEngineAlert';
import { Badge, Button, Card, CardHeader, FadeIn, Input, useToast } from './ui';

type DockerHealth = {
  ok?: boolean;
  version?: string | null;
  hint?: string;
};

export function ServerSettingsPanel() {
  const toast = useToast();
  const [docker, setDocker] = useState<DockerHealth | undefined>();
  const [sshHost, setSshHost] = useState('');
  const [sshUser, setSshUser] = useState('root');
  const [sshLocal, setSshLocal] = useState(true);
  const [sshKeyExists, setSshKeyExists] = useState(false);
  const [sshPublicKey, setSshPublicKey] = useState('');
  const [sshBusy, setSshBusy] = useState(false);

  async function loadSsh() {
    try {
      const s = await api.sshStatus();
      setSshHost(s.ssh_host || '');
      setSshUser(s.ssh_user || 'root');
      setSshLocal(s.local_docker);
      setSshKeyExists(s.key_exists);
      setSshPublicKey(s.public_key || '');
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void loadSsh();
    api
      .health()
      .then((h) => setDocker((h as { backends?: { docker?: DockerHealth } }).backends?.docker))
      .catch(() => setDocker(undefined));
  }, []);

  return (
    <FadeIn>
      <Card>
        <CardHeader
          title="Déploiements"
          action={
            sshLocal ? (
              <Badge tone="ok">Docker local</Badge>
            ) : (
              <Badge tone="accent">SSH distant</Badge>
            )
          }
        />
        <p class="mb-3 text-sm text-[var(--color-ink-muted)]">
          Les apps se déploient via Docker sur cette machine, ou via SSH vers un hôte distant qui a
          Docker. L’exécutable DevForge ne l’embarque pas.
        </p>
        <div class="mb-4">
          <DockerEngineAlert docker={docker} />
        </div>
        <div class="space-y-4">
          <form
            class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              setSshBusy(true);
              try {
                await api.saveSsh({
                  ssh_host: sshHost.trim(),
                  ssh_user: sshUser.trim() || 'root',
                });
                toast.push({ title: 'Serveur enregistré', tone: 'ok' });
                await loadSsh();
              } catch (err) {
                toast.push({
                  title: 'Échec',
                  detail: String((err as Error).message || err),
                  tone: 'danger',
                });
              } finally {
                setSshBusy(false);
              }
            }}
          >
            <div class="min-w-0 w-full flex-1">
              <Input
                label="Host (optionnel)"
                placeholder="vide = Docker local"
                value={sshHost}
                onInput={(e) => setSshHost((e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="w-full sm:w-36 sm:shrink-0">
              <Input
                label="User"
                value={sshUser}
                onInput={(e) => setSshUser((e.target as HTMLInputElement).value)}
              />
            </div>
            <Button type="submit" size="sm" class="w-full sm:w-auto" disabled={sshBusy}>
              Enregistrer
            </Button>
          </form>

          <div class="rounded-xl border border-[var(--color-line)] p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <p class="text-sm font-medium">Clé SSH</p>
              <Badge tone={sshKeyExists ? 'ok' : 'muted'}>
                {sshKeyExists ? 'présente' : 'absente'}
              </Badge>
            </div>
            <p class="mb-3 text-xs text-[var(--color-ink-faint)]">
              Générée dans <code>/data/ssh/</code> — pas dans Variables ZimaOS. Ne colle jamais la
              clé privée dans un champ env.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={sshBusy}
              onClick={async () => {
                setSshBusy(true);
                try {
                  const r = await api.generateSshKey();
                  setSshKeyExists(true);
                  setSshPublicKey(r.public_key || '');
                  toast.push({
                    title: r.created ? 'Clé créée' : 'Clé déjà là',
                    detail: r.hint,
                    tone: 'ok',
                  });
                } catch (err) {
                  toast.push({
                    title: 'Génération KO',
                    detail: String((err as Error).message || err),
                    tone: 'danger',
                  });
                } finally {
                  setSshBusy(false);
                }
              }}
            >
              {sshKeyExists ? 'Afficher la clé' : 'Générer une clé'}
            </Button>
            {sshPublicKey && (
              <div class="mt-3 space-y-2">
                <p class="text-xs text-[var(--color-ink-muted)]">
                  À coller dans <code>~/.ssh/authorized_keys</code> sur le host distant :
                </p>
                <textarea
                  readonly
                  class="h-24 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-2 font-mono text-xs"
                  value={sshPublicKey}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(sshPublicKey);
                      toast.push({ title: 'Clé publique copiée', tone: 'ok' });
                    } catch {
                      toast.push({ title: 'Copie impossible', tone: 'warn' });
                    }
                  }}
                >
                  Copier
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>
    </FadeIn>
  );
}

export function InstanceDomainPanel() {
  const toast = useToast();
  const [serverVersion, setServerVersion] = useState<string | undefined>();
  const [wildcard, setWildcard] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [domainBusy, setDomainBusy] = useState(false);
  const [dnsProvider, setDnsProvider] = useState('');
  const [activeDnsProvider, setActiveDnsProvider] = useState('');
  const [dnsZone, setDnsZone] = useState('');
  const [dnsToken, setDnsToken] = useState('');
  const [porkbunApiKey, setPorkbunApiKey] = useState('');
  const [porkbunSecret, setPorkbunSecret] = useState('');
  const [cfTokenSet, setCfTokenSet] = useState(false);
  const [porkbunKeySet, setPorkbunKeySet] = useState(false);
  const [porkbunSecretSet, setPorkbunSecretSet] = useState(false);
  const [inactiveCreds, setInactiveCreds] = useState<string[]>([]);
  const [dnsStatus, setDnsStatus] = useState<DnsRuntimeStatus | null>(null);
  const [dnsStatusLoading, setDnsStatusLoading] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [clearOnSwitch, setClearOnSwitch] = useState(true);
  const [clearInactiveOnSave, setClearInactiveOnSave] = useState(false);

  function applyDnsFlags(dns: DnsSettingsPublic) {
    setCfTokenSet(!!(dns.cloudflare_token_set || (dns.provider === 'cloudflare' && dns.token_set)));
    setPorkbunKeySet(!!(dns.porkbun_token_set || (dns.api_key_set && dns.secret_set)));
    setPorkbunSecretSet(!!(dns.porkbun_token_set || (dns.api_key_set && dns.secret_set)));
    setInactiveCreds(dns.inactive_credentials ?? []);
    setActiveDnsProvider(dns.provider || '');
  }

  function requestProviderSwitch(next: string) {
    if (next === dnsProvider) return;
    if (activeDnsProvider && activeDnsProvider !== next) {
      setClearOnSwitch(true);
      setSwitchTarget(next);
      return;
    }
    setDnsProvider(next);
    setClearInactiveOnSave(false);
  }

  function confirmProviderSwitch() {
    if (switchTarget === null) return;
    setDnsProvider(switchTarget);
    setClearInactiveOnSave(clearOnSwitch);
    setSwitchTarget(null);
  }

  async function loadDnsStatus() {
    setDnsStatusLoading(true);
    try {
      const r = await api.dnsRuntimeStatus();
      setDnsProvider(r.dns.provider || '');
      setDnsZone(r.dns.zone || '');
      applyDnsFlags(r.dns);
      setDnsStatus(r.status);
    } catch {
      setDnsStatus(null);
    } finally {
      setDnsStatusLoading(false);
    }
  }

  useEffect(() => {
    api
      .bootstrap()
      .then((b) => {
        setWildcard(b.settings?.wildcard_fallback || b.settings?.wildcard_domain || '');
        setInstanceName(b.settings?.instance_name || '');
      })
      .catch(() => null);
    api
      .health()
      .then((h) => setServerVersion((h as { version?: string }).version))
      .catch(() => null);
    api
      .dnsSettings()
      .then((r) => {
        setDnsProvider(r.dns.provider || '');
        setDnsZone(r.dns.zone || '');
        applyDnsFlags(r.dns);
      })
      .catch(() => null);
    void loadDnsStatus();
  }, []);

  return (
    <FadeIn>
      <div class="space-y-4">
        <Card>
          <CardHeader title="Domaine de repli (instance)" />
          <p class="mb-3 text-sm text-[var(--color-ink-muted)]">
            Utilisé pour les comptes qui n’ont pas défini leur propre domaine.
          </p>
          <form
            class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = wildcard.trim().replace(/^\.+/, '').toLowerCase();
              if (!d.includes('.')) {
                toast.push({
                  title: 'Domaine invalide',
                  detail: 'Ex. jeser.app',
                  tone: 'warn',
                });
                return;
              }
              setDomainBusy(true);
              try {
                await api.saveOnboarding({
                  wildcard_domain: d,
                  instance_name: instanceName || undefined,
                });
                setWildcard(d);
                toast.push({
                  title: 'Domaine d’instance enregistré',
                  detail: `Repli → *.${d}`,
                  tone: 'ok',
                });
              } catch (err) {
                toast.push({
                  title: 'Échec',
                  detail: String((err as Error).message || err),
                  tone: 'danger',
                });
              } finally {
                setDomainBusy(false);
              }
            }}
          >
            <div class="min-w-0 w-full flex-1">
              <Input
                label="Wildcard / domaine racine"
                placeholder="jeser.app"
                value={wildcard}
                onInput={(e) => setWildcard((e.target as HTMLInputElement).value)}
              />
            </div>
            <Button type="submit" size="sm" class="w-full sm:w-auto" disabled={domainBusy}>
              Enregistrer
            </Button>
          </form>
        </Card>
        <DnsEntrypointPanel
          isAdmin
          serverVersion={serverVersion}
          dnsProvider={dnsProvider}
          setDnsProvider={setDnsProvider}
          activeDnsProvider={activeDnsProvider}
          dnsZone={dnsZone}
          setDnsZone={setDnsZone}
          dnsToken={dnsToken}
          setDnsToken={setDnsToken}
          porkbunApiKey={porkbunApiKey}
          setPorkbunApiKey={setPorkbunApiKey}
          porkbunSecret={porkbunSecret}
          setPorkbunSecret={setPorkbunSecret}
          cfTokenSet={cfTokenSet}
          porkbunKeySet={porkbunKeySet}
          porkbunSecretSet={porkbunSecretSet}
          inactiveCreds={inactiveCreds}
          dnsStatus={dnsStatus}
          setDnsStatus={setDnsStatus}
          dnsStatusLoading={dnsStatusLoading}
          applyDnsFlags={applyDnsFlags}
          clearInactiveOnSave={clearInactiveOnSave}
          setClearInactiveOnSave={setClearInactiveOnSave}
          requestProviderSwitch={requestProviderSwitch}
          switchTarget={switchTarget}
          setSwitchTarget={setSwitchTarget}
          clearOnSwitch={clearOnSwitch}
          setClearOnSwitch={setClearOnSwitch}
          confirmProviderSwitch={confirmProviderSwitch}
        />
      </div>
    </FadeIn>
  );
}
