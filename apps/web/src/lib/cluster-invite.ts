/** Code unique : `dfjoin_…@https://leader` */

/** Hosts injoignables depuis le leader (aligné sur `validate_worker_advertise_url`). */
export function isLoopbackAdvertiseUrl(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

export function formatJoinCode(leaderUrl: string, token: string): string {
  const url = leaderUrl.trim().replace(/\/+$/, '');
  return `${token.trim()}@${url}`;
}

export function parseJoinCode(raw: string): { leader_url: string; token: string } | null {
  const s = raw.trim();
  if (!s) return null;

  const compact = s.replace(/\s+/g, '');
  const at = compact.match(/^(dfjoin_[A-Za-z0-9]+)@(https?:\/\/.+)$/i);
  if (at) {
    return { token: at[1], leader_url: at[2].replace(/\/+$/, '') };
  }

  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const token =
        u.searchParams.get('token') || u.searchParams.get('t') || (u.hash.startsWith('#dfjoin_') ? u.hash.slice(1) : '');
      if (token.startsWith('dfjoin_')) {
        const port = u.port ? `:${u.port}` : '';
        return { token, leader_url: `${u.protocol}//${u.hostname}${port}` };
      }
    } catch {
      /* ignore */
    }
  }

  let url: string | undefined;
  let token: string | undefined;
  for (const line of s.split(/\s+/).filter(Boolean)) {
    if (line.startsWith('dfjoin_')) token = line;
    else if (/^https?:\/\//i.test(line)) url = line.replace(/\/+$/, '');
  }
  if (url && token) return { leader_url: url, token };
  return null;
}

export type DnsAdvertiseHint = {
  provider: string;
  configured: boolean;
  zone?: string;
};

export type AdvertiseSuggestion = {
  /** URL proposée (peut être vide si rien de fiable). */
  url: string;
  /** source utilisée pour le hint UI */
  source: 'instance_url' | 'dns_domain' | 'origin' | 'none';
  /** label court pour un bouton « utiliser … » */
  label: string;
};

function slugifyHost(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Zone utilisable pour un FQDN nœud (dns.zone > wildcard > parent du leader). */
export function resolveAdvertiseZone(opts: {
  dnsZone?: string;
  wildcardDomain?: string;
  leaderUrl?: string;
}): string {
  const z = (opts.dnsZone || '').trim().replace(/^\.+/, '').toLowerCase();
  if (z) return z;
  const w = (opts.wildcardDomain || '').trim().replace(/^\.+/, '').toLowerCase();
  if (w) return w;
  const leader = (opts.leaderUrl || '').trim();
  if (!leader) return '';
  try {
    const host = new URL(leader).hostname.toLowerCase();
    const parts = host.split('.').filter(Boolean);
    // web.jeser.app → jeser.app ; jeser.app → jeser.app
    if (parts.length >= 2) return parts.slice(-2).join('.');
  } catch {
    /* ignore */
  }
  return '';
}

/**
 * Propose une URL d’annonce :
 * 1. instance_url publique (settings)
 * 2. https://{nœud}.{zone} si stratégie DNS (Cloudflare / Porkbun) ou wildcard
 * 3. origin navigateur si non-loopback
 * 4. sinon vide — l’utilisateur doit saisir (IP LAN ou hostname)
 *
 * Ne force jamais une IP machine détectée en silence.
 */
export function suggestAdvertiseUrl(opts: {
  instanceUrl?: string;
  wildcardDomain?: string;
  dns?: DnsAdvertiseHint | null;
  nodeName?: string;
  leaderUrl?: string;
  origin?: string;
}): AdvertiseSuggestion {
  const instance = (opts.instanceUrl || '').trim().replace(/\/+$/, '');
  if (instance && /^https?:\/\//i.test(instance) && !isLoopbackAdvertiseUrl(instance)) {
    return { url: instance, source: 'instance_url', label: 'URL instance' };
  }

  const dnsOn =
    !!opts.dns?.configured &&
    (opts.dns.provider === 'cloudflare' || opts.dns.provider === 'porkbun');
  const wildcard = (opts.wildcardDomain || '').trim().replace(/^\.+/, '');
  const domainStrategy = dnsOn || !!wildcard;

  const zone = resolveAdvertiseZone({
    dnsZone: opts.dns?.zone,
    wildcardDomain: opts.wildcardDomain,
    leaderUrl: opts.leaderUrl,
  });
  const slug = slugifyHost(opts.nodeName || '');
  if (domainStrategy && zone && slug) {
    const proto =
      (opts.leaderUrl || '').startsWith('http://') || (opts.origin || '').startsWith('http://')
        ? 'http'
        : 'https';
    return {
      url: `${proto}://${slug}.${zone}`,
      source: 'dns_domain',
      label:
        opts.dns?.provider === 'cloudflare'
          ? 'Domaine (Cloudflare)'
          : opts.dns?.provider === 'porkbun'
            ? 'Domaine (Porkbun)'
            : 'Domaine',
    };
  }

  // DNS pas actif localement : proposition domaine depuis le leader (bouton, pas auto-IP).
  if (!domainStrategy && zone && slug) {
    const proto = (opts.leaderUrl || '').startsWith('http://') ? 'http' : 'https';
    return {
      url: `${proto}://${slug}.${zone}`,
      source: 'dns_domain',
      label: 'Domaine (déduit du leader)',
    };
  }

  const origin = (opts.origin || '').trim().replace(/\/+$/, '');
  if (origin && /^https?:\/\//i.test(origin) && !isLoopbackAdvertiseUrl(origin)) {
    return { url: origin, source: 'origin', label: 'Adresse actuelle' };
  }

  return { url: '', source: 'none', label: 'Saisie manuelle' };
}

/** True si on peut préremplir automatiquement (DNS/wildcard/instance), pas juste une déduction. */
export function shouldAutofillAdvertise(suggestion: AdvertiseSuggestion, opts: {
  dns?: DnsAdvertiseHint | null;
  wildcardDomain?: string;
}): boolean {
  if (suggestion.source === 'instance_url' || suggestion.source === 'origin') return true;
  if (suggestion.source !== 'dns_domain') return false;
  const dnsOn =
    !!opts.dns?.configured &&
    (opts.dns.provider === 'cloudflare' || opts.dns.provider === 'porkbun');
  return dnsOn || !!(opts.wildcardDomain || '').trim();
}

export function advertiseHint(opts: {
  dns?: DnsAdvertiseHint | null;
  loopback?: boolean;
  empty?: boolean;
}): string {
  if (opts.loopback) {
    return 'URL d’annonce loopback interdite (127.0.0.1 / localhost) — utilise le domaine (si DNS actif) ou l’IP LAN.';
  }
  if (opts.dns?.configured && opts.dns.provider === 'cloudflare') {
    return 'Cloudflare actif : annonce l’URL publique du nœud (hostname / domaine), pas une IP machine locale. Surcharge manuelle possible.';
  }
  if (opts.dns?.configured && opts.dns.provider === 'porkbun') {
    return 'Porkbun actif : annonce le hostname public ou l’IP joignable depuis le leader — pas 127.0.0.1. Surcharge manuelle possible.';
  }
  if (opts.empty) {
    return 'Obligatoire. Domaine public si DNS (Cloudflare / Porkbun), sinon IP LAN joignable depuis le leader.';
  }
  return 'Adresse sous laquelle le leader joindra ce worker. Modifiable — ne repose pas sur l’IP auto de la machine.';
}
