import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Project } from '../lib/api';
import { cn } from '../lib/cn';

const ICON_PALETTES = [
  { bg: 'from-sky-500 to-blue-700', fg: '#e0f2fe' },
  { bg: 'from-emerald-500 to-teal-700', fg: '#d1fae5' },
  { bg: 'from-amber-500 to-orange-700', fg: '#ffedd5' },
  { bg: 'from-rose-500 to-pink-700', fg: '#ffe4e6' },
  { bg: 'from-violet-500 to-indigo-700', fg: '#ede9fe' },
  { bg: 'from-cyan-400 to-cyan-700', fg: '#cffafe' },
  { bg: 'from-lime-500 to-green-700', fg: '#ecfccb' },
  { bg: 'from-fuchsia-500 to-purple-800', fg: '#fae8ff' },
] as const;

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s-_]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || '?';
}

function hostnameFromUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const first = raw.split(',')[0]?.trim();
  if (!first) return null;
  try {
    const withProto = /^https?:\/\//i.test(first) ? first : `https://${first}`;
    return new URL(withProto).hostname || null;
  } catch {
    return null;
  }
}

function githubOwner(repo?: string | null): string | null {
  if (!repo) return null;
  const cleaned = repo
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^git@github\.com:/i, '');
  const owner = cleaned.split('/').filter(Boolean)[0];
  return owner || null;
}

/** Sources d’icône app : fichiers du site → services → avatar GitHub. */
export function appIconCandidates(project: Project): string[] {
  const host = hostnameFromUrl(project.production_url);
  const owner = githubOwner(project.git_repository);
  const out: string[] = [];

  if (host) {
    const origin = `https://${host}`;
    out.push(`${origin}/apple-touch-icon.png`);
    out.push(`${origin}/apple-touch-icon-precomposed.png`);
    out.push(`${origin}/favicon.svg`);
    out.push(`${origin}/favicon.ico`);
    out.push(`https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`);
    out.push(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`);
    out.push(`https://logo.clearbit.com/${encodeURIComponent(host)}`);
  }
  if (owner) {
    out.push(`https://github.com/${encodeURIComponent(owner)}.png?size=128`);
  }
  return out;
}

export function statusRingClass(tone: 'ok' | 'warn' | 'danger' | 'neutral'): string {
  switch (tone) {
    case 'ok':
      return 'ring-[var(--color-ok)]/70 shadow-[0_0_20px_rgb(74_222_128/0.25)]';
    case 'warn':
      return 'ring-[var(--color-warn)]/70 shadow-[0_0_20px_rgb(251_191_36/0.2)]';
    case 'danger':
      return 'ring-[var(--color-danger)]/70 shadow-[0_0_20px_rgb(248_113_113/0.25)]';
    default:
      return 'ring-white/15';
  }
}

export function statusDotClass(tone: 'ok' | 'warn' | 'danger' | 'neutral'): string {
  switch (tone) {
    case 'ok':
      return 'bg-[var(--color-ok)]';
    case 'warn':
      return 'bg-[var(--color-warn)]';
    case 'danger':
      return 'bg-[var(--color-danger)]';
    default:
      return 'bg-[var(--color-ink-faint)]';
  }
}

type AppIconProps = {
  project: Project;
  statusTone?: 'ok' | 'warn' | 'danger' | 'neutral';
  size?: 'md' | 'lg';
  class?: string;
  ringOffset?: string;
};

export function AppIcon({
  project,
  statusTone,
  size = 'lg',
  class: className,
  ringOffset = 'ring-offset-[#1c1c1e]',
}: AppIconProps) {
  const candidates = useMemo(
    () => appIconCandidates(project),
    [project.production_url, project.git_repository],
  );
  const [idx, setIdx] = useState(0);
  const palette = ICON_PALETTES[hashName(project.name) % ICON_PALETTES.length];
  const src = candidates[idx];
  const failed = !src;

  useEffect(() => {
    setIdx(0);
  }, [project.uuid, project.production_url, project.git_repository]);

  const dim =
    size === 'md'
      ? 'h-12 w-12 rounded-2xl text-base'
      : 'h-16 w-16 rounded-[1.15rem] text-xl sm:h-[4.5rem] sm:w-[4.5rem] sm:text-2xl';

  return (
    <div
      class={cn(
        'relative flex items-center justify-center overflow-hidden transition',
        dim,
        statusTone
          ? `ring-2 ring-offset-2 ${ringOffset} ${statusRingClass(statusTone)}`
          : null,
        failed ? `bg-gradient-to-br ${palette.bg}` : 'bg-[#2a2a2e]',
        className,
      )}
      style={failed ? { color: palette.fg } : undefined}
    >
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          class="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          onError={() => setIdx((i) => i + 1)}
        />
      ) : (
        <span class="font-semibold tracking-tight">{initials(project.name)}</span>
      )}
    </div>
  );
}
