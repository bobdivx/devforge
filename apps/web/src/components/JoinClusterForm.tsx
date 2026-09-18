import { useEffect, useState } from 'preact/hooks';
import {
  advertiseHint,
  isLoopbackAdvertiseUrl,
  parseJoinCode,
  shouldAutofillAdvertise,
  suggestAdvertiseUrl,
  type DnsAdvertiseHint,
} from '../lib/cluster-invite';
import { Button, Input, Spinner } from './ui';

export type JoinAdvertiseContext = {
  instanceUrl?: string;
  wildcardDomain?: string;
  dns?: DnsAdvertiseHint | null;
};

type Props = {
  busy?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  /** Settings locaux (bootstrap) : domaine / DNS pour préremplir intelligemment. */
  context?: JoinAdvertiseContext;
  onCancel?: () => void;
  onSubmit: (body: {
    token: string;
    leader_url: string;
    name?: string;
    advertise_url: string;
  }) => void | Promise<void>;
};

export function JoinClusterForm({
  busy,
  submitLabel = 'Rejoindre',
  cancelLabel = 'Retour',
  context,
  onCancel,
  onSubmit,
}: Props) {
  const [code, setCode] = useState('');
  const [leaderUrl, setLeaderUrl] = useState('');
  const [parsedUrl, setParsedUrl] = useState('');
  const [name, setName] = useState('');
  const [advertiseUrl, setAdvertiseUrl] = useState('');
  /** Dernière suggestion auto appliquée — pour savoir si on peut la remplacer. */
  const [autoAdvertise, setAutoAdvertise] = useState('');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  function recomputeSuggestion(next: { leader?: string; name?: string }) {
    return suggestAdvertiseUrl({
      instanceUrl: context?.instanceUrl,
      wildcardDomain: context?.wildcardDomain,
      dns: context?.dns,
      nodeName: next.name ?? name,
      leaderUrl: next.leader ?? leaderUrl,
      origin,
    });
  }

  function maybeAutofill(s: ReturnType<typeof suggestAdvertiseUrl>) {
    if (!shouldAutofillAdvertise(s, { dns: context?.dns, wildcardDomain: context?.wildcardDomain })) {
      return;
    }
    if (!advertiseUrl || advertiseUrl === autoAdvertise) {
      setAdvertiseUrl(s.url);
      setAutoAdvertise(s.url);
    }
  }

  useEffect(() => {
    maybeAutofill(recomputeSuggestion({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    context?.instanceUrl,
    context?.wildcardDomain,
    context?.dns?.provider,
    context?.dns?.configured,
    context?.dns?.zone,
  ]);

  function onCodeInput(raw: string) {
    setCode(raw);
    const parsed = parseJoinCode(raw);
    if (!parsed) return;
    if (!leaderUrl.trim() || leaderUrl.trim() === parsedUrl) {
      setLeaderUrl(parsed.leader_url);
      maybeAutofill(recomputeSuggestion({ leader: parsed.leader_url }));
    }
    setParsedUrl(parsed.leader_url);
  }

  function onLeaderInput(raw: string) {
    setLeaderUrl(raw);
    maybeAutofill(recomputeSuggestion({ leader: raw }));
  }

  function onNameInput(raw: string) {
    setName(raw);
    const s = recomputeSuggestion({ name: raw });
    if (s.source === 'dns_domain') {
      maybeAutofill(s);
    }
  }

  function applySuggestion() {
    const s = recomputeSuggestion({});
    setAdvertiseUrl(s.url);
    setAutoAdvertise(s.url);
  }

  function parsedToken(): string | null {
    const parsed = parseJoinCode(code) || parseJoinCode(`${code.trim()}@${leaderUrl.trim()}`);
    if (parsed?.token) return parsed.token;
    const t = code.trim();
    if (/^dfjoin_[A-Za-z0-9]+$/i.test(t)) return t;
    return null;
  }

  const token = parsedToken();
  const url = leaderUrl.trim().replace(/\/+$/, '');
  const urlOk = /^https?:\/\//i.test(url);
  const advertise = advertiseUrl.trim().replace(/\/+$/, '');
  const advertiseOk =
    /^https?:\/\//i.test(advertise) && !isLoopbackAdvertiseUrl(advertise);
  const advertiseLoopback = !!advertise && isLoopbackAdvertiseUrl(advertise);
  const canSubmit = !!token && urlOk && advertiseOk && !busy;
  const suggestion = recomputeSuggestion({});
  const dns = context?.dns;

  return (
    <form
      class="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!token || !urlOk || !advertiseOk) return;
        onSubmit({
          token,
          leader_url: url,
          name: name.trim() || undefined,
          advertise_url: advertise,
        });
      }}
    >
      <Input
        label="Code d’invitation"
        value={code}
        placeholder="dfjoin_…"
        required
        autocomplete="off"
        onInput={(e) => onCodeInput((e.target as HTMLInputElement).value)}
        hint="Le jeton copié sur le leader (Cluster → Invitation)."
      />
      <Input
        label="URL du leader"
        value={leaderUrl}
        placeholder="https://"
        required
        onInput={(e) => onLeaderInput((e.target as HTMLInputElement).value)}
        hint="Adresse joignable depuis cette machine. Pas collée dans le jeton — tu la choisis ici."
      />
      <div class="space-y-1.5">
        <Input
          label="URL d’annonce de ce nœud"
          value={advertiseUrl}
          placeholder={
            dns?.configured
              ? 'https://mon-noeud.exemple.com'
              : 'http://192.168.x.x:8000 ou https://hostname'
          }
          required
          onInput={(e) => setAdvertiseUrl((e.target as HTMLInputElement).value)}
          hint={advertiseHint({
            dns,
            loopback: advertiseLoopback,
            empty: !advertise,
          })}
        />
        <div class="flex flex-wrap gap-2">
          {suggestion.url && suggestion.url !== advertise && (
            <Button type="button" size="sm" variant="ghost" onClick={applySuggestion}>
              Utiliser : {suggestion.label}
            </Button>
          )}
          {origin &&
            !isLoopbackAdvertiseUrl(origin) &&
            origin.replace(/\/+$/, '') !== advertise && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdvertiseUrl(origin.replace(/\/+$/, ''));
                  setAutoAdvertise('');
                }}
              >
                Adresse du navigateur
              </Button>
            )}
          {advertise && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdvertiseUrl('');
                setAutoAdvertise('');
              }}
            >
              Effacer
            </Button>
          )}
        </div>
        {dns?.configured ? (
          <p class="text-xs text-[var(--color-ink-muted)]">
            DNS{' '}
            {dns.provider === 'cloudflare'
              ? 'Cloudflare'
              : dns.provider === 'porkbun'
                ? 'Porkbun'
                : dns.provider}
            {dns.zone ? ` · zone ${dns.zone}` : ''} — préremplissage domaine possible ; l’IP
            machine n’est jamais forcée.
          </p>
        ) : (
          <p class="text-xs text-[var(--color-ink-muted)]">
            Champ obligatoire. Si le leader a Cloudflare / Porkbun, tu peux coller le hostname
            public (bouton Domaine) ; sinon l’IP LAN.
          </p>
        )}
      </div>
      <Input
        label="Nom de ce nœud"
        value={name}
        placeholder="nom du nœud"
        onInput={(e) => onNameInput((e.target as HTMLInputElement).value)}
        hint="Optionnel — sinon le nom de la machine. Sert aussi à proposer le FQDN si DNS."
      />
      <div class="flex gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        <Button type="submit" class="flex-1" disabled={!canSubmit}>
          {busy ? <Spinner /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
