/** Code unique : `dfjoin_…@https://leader` */

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
