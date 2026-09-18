import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  api,
  type DnsDomainStatus,
  type DnsNodeStatus,
  type DnsRuntimeStatus,
  type DnsSettingsPublic,
} from '../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  Input,
  Modal,
  ProgressBar,
  PulseDot,
  Skeleton,
  Spinner,
  useToast,
} from './ui';

function providerLabel(p: string): string {
  if (p === 'cloudflare') return 'Cloudflare';
  if (p === 'porkbun') return 'Porkbun';
  return 'Aucun';
}

function shortTarget(t: string): string {
  const s = String(t ?? '').trim();
  if (s.endsWith('cfargotunnel.com')) {
    const id = s.split('.')[0] || s;
    return `tunnel ${id.slice(0, 8)}…`;
  }
  return s.length > 40 ? `${s.slice(0, 36)}…` : s;
}

function explainDomain(d: DnsDomainStatus, provider: string): {
  title: string;
  detail: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  fixable: boolean;
} {
  if (d.out_of_zone) {
    return {
      title: 'Pas sur ce compte DNS',
      detail:
        d.error ||
        (provider === 'cloudflare'
          ? 'Ce domaine n’est pas une zone de ton compte Cloudflare. Ajoute-le dans Cloudflare, ou retire-le du projet.'
          : 'Ce domaine n’est pas dans la zone Porkbun configurée.'),
      tone: 'neutral',
      fixable: false,
    };
  }
  if (d.in_sync) {
    return {
      title: 'OK',
      detail: d.live ? `Pointe vers ${shortTarget(d.live)}` : 'Record à jour',
      tone: 'ok',
      fixable: false,
    };
  }
  if (d.live && d.target && d.live !== d.target) {
    return {
      title: 'Ancien tunnel / mauvaise cible',
      detail: `Chez ${providerLabel(provider)} : ${shortTarget(d.live)} — attendu : ${shortTarget(d.target)}. Un resync corrige ça.`,
      tone: 'danger',
      fixable: true,
    };
  }
  if (!d.live) {
    return {
      title: 'Record manquant',
      detail: `Pas encore de DNS chez ${providerLabel(provider)}. Un resync le crée vers ${shortTarget(d.target || 'le nœud')}.`,
      tone: 'danger',
      fixable: true,
    };
  }
  return {
    title: 'Pas en sync',
    detail: d.error || 'Le DNS ne correspond pas à la cible attendue.',
    tone: 'danger',
    fixable: true,
  };
}

function explainNode(n: DnsNodeStatus, provider: string): {
  title: string;
  detail: string;
  tone: 'ok' | 'warn' | 'danger';
  dnsFixable: boolean;
} {
  if (n.ok) {
    return {
      title: 'Prêt',
      detail:
        provider === 'cloudflare'
          ? 'Traefik + cloudflared OK'
          : 'Traefik OK, IP publique prête',
      tone: 'ok',
      dnsFixable: false,
    };
  }
  const err = (n.error || '').toLowerCase();
  if (err.includes('pas un nœud worker') || err.includes('injoignable')) {
    return {
      title: 'Nœud injoignable',
      detail:
        'Ce n’est pas un problème DNS. Le worker ne répond pas (rôle / secret). Répare-le dans Cluster / Runners, puis reviens ici.',
      tone: 'danger',
      dnsFixable: false,
    };
  }
  if (err.includes('tunnel cloudflare résiduelle') || err.includes('tunnel')) {
    return {
      title: 'Cible tunnel à remplacer',
      detail: 'Un resync force l’IP publique (Porkbun) ou vérifie le tunnel (Cloudflare).',
      tone: 'warn',
      dnsFixable: true,
    };
  }
  if (!n.traefik || (provider === 'cloudflare' && !n.cloudflared)) {
    return {
      title: 'Services down',
      detail:
        provider === 'cloudflare'
          ? `Traefik ${n.traefik ? 'up' : 'down'} · cloudflared ${n.cloudflared ? 'up' : 'down'}. Un resync tente de les relancer.`
          : `Traefik ${n.traefik ? 'up' : 'down'}.`,
      tone: 'warn',
      dnsFixable: true,
    };
  }
  return {
    title: 'À corriger',
    detail: n.error || 'État incomplet',
    tone: 'danger',
    dnsFixable: true,
  };
}

const SYNC_STEPS = [
  'Vérification du token…',
  'Tunnels / nœuds…',
  'Écriture des records DNS…',
  'Contrôle final…',
];

type Props = {
  isAdmin: boolean;
  serverVersion?: string;
  dnsProvider: string;
  setDnsProvider: (v: string) => void;
  activeDnsProvider: string;
  dnsZone: string;
  setDnsZone: (v: string) => void;
  dnsToken: string;
  setDnsToken: (v: string) => void;
  porkbunApiKey: string;
  setPorkbunApiKey: (v: string) => void;
  porkbunSecret: string;
  setPorkbunSecret: (v: string) => void;
  cfTokenSet: boolean;
  porkbunKeySet: boolean;
  porkbunSecretSet: boolean;
  inactiveCreds: string[];
  dnsStatus: DnsRuntimeStatus | null;
  setDnsStatus: (s: DnsRuntimeStatus | null) => void;
  dnsStatusLoading: boolean;
  applyDnsFlags: (dns: DnsSettingsPublic) => void;
  clearInactiveOnSave: boolean;
  setClearInactiveOnSave: (v: boolean) => void;
  requestProviderSwitch: (next: string) => void;
  switchTarget: string | null;
  setSwitchTarget: (v: string | null) => void;
  clearOnSwitch: boolean;
  setClearOnSwitch: (v: boolean) => void;
  confirmProviderSwitch: () => void;
};

export function DnsEntrypointPanel(props: Props) {
  const {
    isAdmin,
    serverVersion,
    dnsProvider,
    setDnsProvider,
    activeDnsProvider,
    dnsZone,
    setDnsZone,
    dnsToken,
    setDnsToken,
    porkbunApiKey,
    setPorkbunApiKey,
    porkbunSecret,
    setPorkbunSecret,
    cfTokenSet,
    porkbunKeySet,
    porkbunSecretSet,
    inactiveCreds,
    dnsStatus,
    setDnsStatus,
    dnsStatusLoading,
    applyDnsFlags,
    clearInactiveOnSave,
    setClearInactiveOnSave,
    requestProviderSwitch,
    switchTarget,
    setSwitchTarget,
    clearOnSwitch,
    setClearOnSwitch,
    confirmProviderSwitch,
  } = props;

  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStep, setSyncStep] = useState(0);
  const [lastSyncSummary, setLastSyncSummary] = useState<string | null>(null);
  const [lastSyncResults, setLastSyncResults] = useState<
    { fqdn: string; ok: boolean; error?: string }[]
  >([]);
  const [lastServerVersion, setLastServerVersion] = useState<string | undefined>(
    serverVersion,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!activeDnsProvider) setShowAdvanced(true);
  }, [activeDnsProvider]);

  useEffect(() => {
    if (serverVersion) setLastServerVersion(serverVersion);
  }, [serverVersion]);

  useEffect(() => {
    if (dnsStatus?.server_version) setLastServerVersion(dnsStatus.server_version);
  }, [dnsStatus?.server_version]);

  const syncApiOk =
    !dnsStatus || (dnsStatus.dns_sync_api ?? 0) >= 2 || !!dnsStatus.sync_results;
  const showOldServerAlert = !!dnsStatus && !syncApiOk;

  const domains = dnsStatus?.domains ?? [];
  const nodes = dnsStatus?.nodes ?? [];

  const domainExplained = useMemo(
    () =>
      domains.map((d) => ({
        d,
        ...explainDomain(d, dnsStatus?.provider || activeDnsProvider),
      })),
    [domains, dnsStatus?.provider, activeDnsProvider],
  );

  const nodeExplained = useMemo(
    () =>
      nodes.map((n) => ({
        n,
        ...explainNode(n, dnsStatus?.provider || activeDnsProvider),
      })),
    [nodes, dnsStatus?.provider, activeDnsProvider],
  );

  const fixableDomains = domainExplained.filter((x) => x.fixable);
  const okDomains = domainExplained.filter((x) => x.tone === 'ok');
  const blockedDomains = domainExplained.filter(
    (x) => x.d.out_of_zone || (!x.fixable && x.tone !== 'ok'),
  );
  const brokenNodes = nodeExplained.filter((x) => !x.n.ok);
  const clusterOnlyNodes = nodeExplained.filter((x) => !x.n.ok && !x.dnsFixable);

  const needsDnsFix = fixableDomains.length > 0 || nodeExplained.some((x) => x.dnsFixable && !x.n.ok);
  const allGood = !!dnsStatus?.ok;

  useEffect(() => {
    if (!syncing) return;
    setSyncProgress(8);
    setSyncStep(0);
    const timers = [
      setTimeout(() => {
        setSyncStep(1);
        setSyncProgress(28);
      }, 400),
      setTimeout(() => {
        setSyncStep(2);
        setSyncProgress(55);
      }, 1100),
      setTimeout(() => {
        setSyncStep(3);
        setSyncProgress(78);
      }, 2000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [syncing]);

  async function runResync() {
    if (!isAdmin || syncing) return;
    const beforeBroken = fixableDomains.length;
    setSyncing(true);
    setBusy(true);
    setLastSyncSummary(null);
    setLastSyncResults([]);
    try {
      const r = await api.resyncDnsSettings();
      applyDnsFlags(r.dns);
      setDnsProvider(r.dns.provider || '');
      setDnsZone(r.dns.zone || '');
      if (r.status) setDnsStatus(r.status);
      if (r.server_version) setLastServerVersion(r.server_version);
      else if (r.status?.server_version) setLastServerVersion(r.status.server_version);
      setSyncProgress(100);
      const results = r.status?.sync_results ?? [];
      setLastSyncResults(results);
      const apiOk = (r.status?.dns_sync_api ?? 0) >= 2;
      const wroteOk = results.filter((x) => x.ok).length;
      const wroteFail = results.filter((x) => !x.ok);
      const after = (r.status?.domains ?? []).filter(
        (d) => d.in_sync === false && !d.out_of_zone,
      ).length;
      const fixed = Math.max(0, beforeBroken - after);
      let summary: string;
      if (!apiOk) {
        summary = `Serveur ${r.server_version || r.status?.server_version || lastServerVersion || '?'} trop ancien — mets à jour vers 2.0.82+ (Settings → Mise à jour)`;
      } else if (r.provision_error) {
        summary = `Resync partiel : ${r.provision_error}`;
      } else if (wroteFail.length > 0) {
        summary = `${wroteOk} écrit(s) OK · ${wroteFail.length} échec(s) : ${wroteFail
          .slice(0, 2)
          .map((x) => `${x.fqdn} (${x.error || 'erreur'})`)
          .join(' · ')}${wroteFail.length > 2 ? '…' : ''}`;
      } else if (fixed > 0) {
        summary = `${fixed} domaine${fixed > 1 ? 's' : ''} corrigé${fixed > 1 ? 's' : ''}${
          after > 0 ? ` · ${after} encore en erreur` : ''
        }`;
      } else if (after === 0 && (r.status?.ok || beforeBroken === 0)) {
        summary = 'Tout est à jour';
      } else if (after > 0) {
        summary = `${after} domaine${after > 1 ? 's' : ''} encore à corriger (voir détails)`;
      } else {
        summary = 'État actualisé';
      }
      setLastSyncSummary(summary);
      toast.push({
        title: r.status?.ok ? 'DNS OK' : 'Resync terminé',
        detail: summary,
        tone: r.status?.ok ? 'ok' : r.provision_error ? 'danger' : 'warn',
      });
    } catch (err) {
      toast.push({
        title: 'Resync impossible',
        detail: String((err as Error).message || err),
        tone: 'danger',
      });
      setLastSyncSummary(String((err as Error).message || err));
    } finally {
      setSyncing(false);
      setBusy(false);
      setTimeout(() => setSyncProgress(0), 800);
    }
  }

  return (
    <>
      <Card class="mt-4">
        <CardHeader
          title="Entrée publique"
          action={
            dnsStatusLoading && !dnsStatus ? (
              <Spinner />
            ) : allGood ? (
              <Badge tone="ok">opérationnel</Badge>
            ) : activeDnsProvider ? (
              <Badge tone="danger">à corriger</Badge>
            ) : (
              <Badge tone="neutral">off</Badge>
            )
          }
        />

        <FadeIn>
          <div class="mb-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                En place maintenant
              </p>
              {lastServerVersion && (
                <Badge tone={syncApiOk ? 'ok' : 'warn'}>v{lastServerVersion}</Badge>
              )}
            </div>
            <p class="mt-1 text-base font-medium text-[var(--color-ink)]">
              {activeDnsProvider
                ? `${providerLabel(activeDnsProvider)}${
                    (dnsStatus?.zone || dnsZone) ? ` · ${dnsStatus?.zone || dnsZone}` : ''
                  }`
                : 'Aucun DNS automatique'}
            </p>
            <p class="mt-1 text-sm text-[var(--color-ink-muted)]">
              {activeDnsProvider === 'cloudflare'
                ? 'Cloudflare crée un tunnel par machine et des CNAME vers ce tunnel. Pas besoin d’ouvrir les ports 80/443.'
                : activeDnsProvider === 'porkbun'
                  ? 'Porkbun pousse des records A vers l’IP publique de chaque nœud. Ports 80/443 requis.'
                  : 'Choisis Cloudflare ou Porkbun ci-dessous pour publier tes apps.'}
            </p>
          </div>
        </FadeIn>

        {activeDnsProvider && showOldServerAlert && (
          <Alert tone="danger" class="mb-4">
            <p class="font-medium">
              Serveur trop ancien{lastServerVersion ? ` (v${lastServerVersion})` : ''}
            </p>
            <p class="mt-1 text-sm">
              Le correctif DNS (écriture CNAME + détails) exige{' '}
              <strong>2.0.82+</strong>. Sans ça, « Corriger les DNS » ne peut pas réécrire les
              tunnels.
            </p>
            <a
              href="/app/settings?tab=update"
              class="mt-2 inline-block text-sm font-medium text-[var(--color-accent)] underline"
            >
              Aller à Mise à jour →
            </a>
          </Alert>
        )}

        {activeDnsProvider && dnsStatus && (
          <FadeIn delay={40}>
            <div class="mb-4 space-y-3">
              {allGood ? (
                <Alert tone="ok">
                  Tout est bon : nœuds prêts et domaines synchronisés avec{' '}
                  {providerLabel(activeDnsProvider)}.
                </Alert>
              ) : (
                <Alert tone={dnsStatus.token_ok ? 'warn' : 'danger'}>
                  <p class="font-medium">Voici ce qui bloque</p>
                  <ul class="mt-2 list-disc space-y-1 pl-4 text-sm">
                    {fixableDomains.length > 0 && (
                      <li>
                        {fixableDomains.length} domaine
                        {fixableDomains.length > 1 ? 's' : ''} DNS à corriger (mauvais tunnel ou
                        record manquant) — le bouton ci-dessous s’en occupe.
                      </li>
                    )}
                    {clusterOnlyNodes.length > 0 && (
                      <li>
                        {clusterOnlyNodes.map((x) => x.n.name).join(', ')} : nœud injoignable —
                        à réparer dans Cluster, pas ici.
                      </li>
                    )}
                    {blockedDomains.length > 0 && (
                      <li>
                        {blockedDomains.length} domaine
                        {blockedDomains.length > 1 ? 's' : ''} hors compte / hors zone — à gérer à
                        la main (ajouter la zone chez le provider, ou retirer du projet).
                      </li>
                    )}
                    {!dnsStatus.token_ok && dnsStatus.error && <li>{dnsStatus.error}</li>}
                    {fixableDomains.length === 0 &&
                      clusterOnlyNodes.length === 0 &&
                      blockedDomains.length === 0 && (
                        <li>
                          {dnsStatus.error ||
                            'Token OK, mais le provisionnement n’est pas complet.'}
                        </li>
                      )}
                  </ul>
                </Alert>
              )}

              {isAdmin && (needsDnsFix || !allGood) && (
                <div class="rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 px-3 py-3">
                  <p class="text-sm font-medium text-[var(--color-ink)]">
                    Action recommandée
                  </p>
                  <p class="mt-1 text-xs text-[var(--color-ink-muted)]">
                    Relance tunnels + réécrit les CNAME / records A pour chaque app. Ça ne
                    répare pas un worker cluster HS.
                  </p>
                  <Button
                    type="button"
                    class="mt-3 w-full sm:w-auto"
                    disabled={busy || syncing || !activeDnsProvider}
                    onClick={() => void runResync()}
                  >
                    {syncing ? (
                      <span class="inline-flex items-center gap-2">
                        <Spinner /> Correction en cours…
                      </span>
                    ) : (
                      'Corriger les DNS maintenant'
                    )}
                  </Button>
                  {(syncing || syncProgress > 0) && (
                    <div class="mt-3 space-y-2">
                      <ProgressBar value={syncProgress} />
                      <p class="text-xs text-[var(--color-ink-muted)]">
                        {syncing ? SYNC_STEPS[syncStep] : lastSyncSummary || 'Terminé'}
                      </p>
                    </div>
                  )}
                  {!syncing && lastSyncSummary && (
                    <div class="mt-2 space-y-1">
                      <p class="text-xs text-[var(--color-ink)]">{lastSyncSummary}</p>
                      {lastSyncResults.length > 0 && (
                        <ul class="max-h-40 space-y-1 overflow-y-auto text-[11px] text-[var(--color-ink-muted)]">
                          {lastSyncResults.map((x) => (
                            <li key={x.fqdn} class="break-words">
                              {x.ok ? '✓' : '✗'} {x.fqdn}
                              {x.error ? ` — ${x.error}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                      {lastSyncResults.length === 0 && (
                        <p class="text-[11px] text-[var(--color-warn)]">
                          {(dnsStatus?.dns_sync_api ?? 0) < 2
                            ? `Serveur ${lastServerVersion || '?'} sans API sync v2 — mets à jour (Settings → Mise à jour) puis réessaie.`
                            : 'Aucun domaine à synchroniser (liste vide côté serveur).'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isAdmin && allGood && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  class="w-full sm:w-auto"
                  disabled={busy || syncing}
                  onClick={() => void runResync()}
                >
                  {syncing ? (
                    <span class="inline-flex items-center gap-2">
                      <Spinner /> Vérification…
                    </span>
                  ) : (
                    'Revérifier / resync'
                  )}
                </Button>
              )}
            </div>
          </FadeIn>
        )}

        {activeDnsProvider && dnsStatusLoading && !dnsStatus && (
          <Skeleton class="mb-3 h-24" />
        )}

        {activeDnsProvider && dnsStatus && (
          <div class="mb-4 space-y-4">
            <section>
              <p class="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                Machines ({nodes.filter((n) => n.ok).length}/{nodes.length} OK)
              </p>
              <div class="space-y-2">
                {nodeExplained.map(({ n, title, detail, tone }) => (
                  <div
                    key={n.id}
                    class="min-w-0 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div class="flex min-w-0 items-center gap-2">
                        <PulseDot tone={tone === 'ok' ? 'ok' : 'warn'} />
                        <span class="truncate text-sm font-medium text-[var(--color-ink)]">
                          {n.name}
                        </span>
                        <span class="text-xs text-[var(--color-ink-muted)]">{n.role}</span>
                      </div>
                      <Badge tone={tone === 'ok' ? 'ok' : 'danger'}>{title}</Badge>
                    </div>
                    <p class="mt-1.5 text-xs text-[var(--color-ink-muted)]">{detail}</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <p class="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                Domaines des apps ({okDomains.length}/{domains.length} OK)
              </p>
              {domains.length === 0 ? (
                <p class="text-xs text-[var(--color-ink-muted)]">
                  Aucune app avec un domaine public pour l’instant. Les records se créent au
                  prochain déploiement.
                </p>
              ) : (
                <div class="space-y-2">
                  {domainExplained.map(({ d, title, detail, tone }) => (
                    <div
                      key={`${d.project_uuid}-${d.fqdn}`}
                      class="min-w-0 rounded-xl border border-[var(--color-line)] px-3 py-2.5"
                    >
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="break-all font-mono text-sm text-[var(--color-ink)]">
                          {d.fqdn}
                        </span>
                        <Badge
                          tone={
                            tone === 'ok'
                              ? 'ok'
                              : tone === 'danger'
                                ? 'danger'
                                : tone === 'warn'
                                  ? 'warn'
                                  : 'neutral'
                          }
                        >
                          {title}
                        </Badge>
                      </div>
                      <p class="mt-1 text-xs text-[var(--color-ink-muted)]">
                        App « {d.project} » — {detail}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {!activeDnsProvider && (
          <Alert tone="info" class="mb-3">
            Active Cloudflare (recommandé si tes domaines sont déjà chez Cloudflare) ou Porkbun
            (records A directs). Un seul système à la fois.
          </Alert>
        )}

        {inactiveCreds.length > 0 && (
          <div class="mb-4 rounded-xl border border-dashed border-[var(--color-line)] px-3 py-3">
            <p class="text-xs font-medium text-[var(--color-ink)]">
              Anciens accès non utilisés
            </p>
            <p class="mt-1 text-xs text-[var(--color-ink-muted)]">
              Ils ne pilotent rien tant que {providerLabel(activeDnsProvider || '')} est actif.
              Tu peux les effacer pour y voir clair.
            </p>
            <ul class="mt-2 space-y-2">
              {inactiveCreds.map((p) => (
                <li
                  key={p}
                  class="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--color-ink)]"
                >
                  <span>{providerLabel(p)}</span>
                  {isAdmin && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const r = await api.clearDnsCredentials(
                            p === 'cloudflare' ? 'cloudflare' : 'porkbun',
                          );
                          applyDnsFlags(r.dns);
                          setDnsProvider(r.dns.provider || '');
                          if (r.status) setDnsStatus(r.status);
                          toast.push({
                            title: 'Accès effacé',
                            detail: providerLabel(p),
                            tone: 'ok',
                          });
                        } catch (err) {
                          toast.push({
                            title: 'Échec',
                            detail: String((err as Error).message || err),
                            tone: 'danger',
                          });
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Effacer
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {isAdmin ? (
          <div class="border-t border-[var(--color-line)] pt-3">
            <button
              type="button"
              class="flex w-full items-center justify-between text-left text-sm font-medium text-[var(--color-ink)]"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              <span>Configuration (token, provider)</span>
              <span class="text-[var(--color-ink-muted)]">{showAdvanced ? '▾' : '▸'}</span>
            </button>
            {showAdvanced && (
              <form
                class="mt-3 flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    const base = {
                      provider: dnsProvider,
                      zone: dnsZone,
                      clear_inactive: clearInactiveOnSave || undefined,
                    };
                    const r = await api.saveDnsSettings(
                      dnsProvider === 'porkbun'
                        ? {
                            ...base,
                            api_key: porkbunApiKey.trim() || undefined,
                            secret: porkbunSecret.trim() || undefined,
                          }
                        : {
                            ...base,
                            token: dnsToken.trim() || undefined,
                          },
                    );
                    setDnsProvider(r.dns.provider);
                    setDnsZone(r.dns.zone);
                    applyDnsFlags(r.dns);
                    setDnsToken('');
                    setPorkbunApiKey('');
                    setPorkbunSecret('');
                    setClearInactiveOnSave(false);
                    if (r.status) setDnsStatus(r.status);
                    toast.push({
                      title: r.status?.ok ? 'Entrée publique OK' : 'Enregistré',
                      detail: r.provision_error || undefined,
                      tone: r.provision_error ? 'danger' : r.status?.ok ? 'ok' : 'warn',
                    });
                    if (r.dns.provider) {
                      setTimeout(() => void runResync(), 200);
                    }
                  } catch (err) {
                    toast.push({
                      title: 'Échec',
                      detail: String((err as Error).message || err),
                      tone: 'danger',
                    });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div class="grid grid-cols-3 gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    class="w-full px-1.5 sm:px-3"
                    variant={dnsProvider === 'cloudflare' ? 'secondary' : 'ghost'}
                    onClick={() => requestProviderSwitch('cloudflare')}
                  >
                    Cloudflare
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    class="w-full px-1.5 sm:px-3"
                    variant={dnsProvider === 'porkbun' ? 'secondary' : 'ghost'}
                    onClick={() => requestProviderSwitch('porkbun')}
                  >
                    Porkbun
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    class="w-full px-1.5 sm:px-3"
                    variant={!dnsProvider ? 'secondary' : 'ghost'}
                    onClick={() => requestProviderSwitch('')}
                  >
                    Off
                  </Button>
                </div>
                {dnsProvider === 'cloudflare' && (
                  <p class="text-xs text-[var(--color-ink-muted)]">
                    Token avec Account Tunnel Edit, Zone DNS Edit, Account Read.
                  </p>
                )}
                {dnsProvider === 'porkbun' && (
                  <p class="text-xs text-[var(--color-ink-muted)]">
                    API Key (`pk1_…`) + Secret (`sk1_…`) depuis Porkbun → API Access.
                  </p>
                )}
                {dnsProvider ? (
                  <>
                    <Input
                      label="Zone DNS principale"
                      placeholder="jeser.app"
                      value={dnsZone}
                      onInput={(e) => setDnsZone((e.target as HTMLInputElement).value)}
                      hint="Avec Cloudflare, les autres zones du même compte (popcornn.app…) sont aussi gérées."
                    />
                    {dnsProvider === 'porkbun' ? (
                      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Input
                          label="Clé API"
                          type="password"
                          autocomplete="off"
                          placeholder={porkbunKeySet ? '•••• déjà enregistrée' : 'API Key'}
                          value={porkbunApiKey}
                          onInput={(e) =>
                            setPorkbunApiKey((e.target as HTMLInputElement).value)
                          }
                        />
                        <Input
                          label="Secret API"
                          type="password"
                          autocomplete="off"
                          placeholder={
                            porkbunSecretSet ? '•••• déjà enregistré' : 'Secret API Key'
                          }
                          value={porkbunSecret}
                          onInput={(e) =>
                            setPorkbunSecret((e.target as HTMLInputElement).value)
                          }
                        />
                      </div>
                    ) : (
                      <Input
                        label="Token Cloudflare"
                        type="password"
                        autocomplete="off"
                        placeholder={cfTokenSet ? '•••• déjà enregistré' : 'Token Cloudflare'}
                        value={dnsToken}
                        onInput={(e) => setDnsToken((e.target as HTMLInputElement).value)}
                      />
                    )}
                  </>
                ) : null}
                {clearInactiveOnSave && (
                  <Alert tone="warn">
                    À l’enregistrement, les accès de l’ancien provider seront effacés.
                  </Alert>
                )}
                <div class="flex flex-col gap-2 sm:flex-row">
                  <Button type="submit" size="sm" disabled={busy}>
                    Enregistrer la config
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy || !dnsProvider}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await api.testDnsSettings();
                        if (r.status) setDnsStatus(r.status);
                        toast.push({
                          title: r.status?.ok ? 'Connexion OK' : 'Joignable, état incomplet',
                          detail: r.status?.error || undefined,
                          tone: r.status?.ok ? 'ok' : 'warn',
                        });
                      } catch (err) {
                        toast.push({
                          title: 'Ping KO',
                          detail: String((err as Error).message || err),
                          tone: 'danger',
                        });
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Tester la connexion
                  </Button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <Alert tone="warn">Réservé à l’admin instance.</Alert>
        )}
      </Card>

      <Modal
        open={switchTarget !== null}
        onClose={() => setSwitchTarget(null)}
        title="Changer de système DNS"
        size="sm"
        description="Un seul provider pilote l’entrée publique."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setSwitchTarget(null)}>
              Annuler
            </Button>
            <Button type="button" onClick={confirmProviderSwitch}>
              Continuer
            </Button>
          </>
        }
      >
        <p class="text-sm text-[var(--color-ink)]">
          Passer de <strong>{providerLabel(activeDnsProvider || dnsProvider)}</strong> à{' '}
          <strong>{providerLabel(switchTarget || '')}</strong>.
        </p>
        <label class="mt-4 flex cursor-pointer items-start gap-2 text-sm text-[var(--color-ink)]">
          <input
            type="checkbox"
            class="mt-1"
            checked={clearOnSwitch}
            onChange={(e) => setClearOnSwitch((e.target as HTMLInputElement).checked)}
          />
          <span>Effacer les accès de l’ancien provider à l’enregistrement (recommandé).</span>
        </label>
      </Modal>
    </>
  );
}
