import type { JSX } from 'preact';
import { useId } from 'preact/hooks';
import type { PersonaKey } from '../../lib/personas';
import { cn } from '../../lib/cn';

type Props = {
  persona: PersonaKey;
  size?: number;
  class?: string;
  title?: string;
};

/** Avatars SVG des personnages (dégradés + deux yeux). Ids uniques par instance. */
export function PersonaAvatar({ persona, size = 34, class: className, title }: Props) {
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const g = `pa-${persona}-${raw}`;
  const common: JSX.IntrinsicElements['svg'] = {
    width: size,
    height: size,
    viewBox: '0 0 64 64',
    class: cn('shrink-0', className),
    role: title ? 'img' : undefined,
    'aria-hidden': title ? undefined : true,
  };

  if (persona === 'braise') {
    return (
      <svg {...common}>
        {title ? <title>{title}</title> : null}
        <defs>
          <radialGradient id={g} cx=".35" cy=".3" r=".9">
            <stop offset="0" stop-color="#fde68a" />
            <stop offset=".45" stop-color="#fb923c" />
            <stop offset="1" stop-color="#c2410c" />
          </radialGradient>
        </defs>
        <path
          d="M32 4c4 8 14 10 14 20 0 3-1 5-2 7 6 3 10 9 10 16 0 10-10 15-22 15S10 57 10 47c0-8 5-14 12-17-1-2-2-4-2-7 0-7 6-9 8-14 1 4 3 6 4 6 0-4 0-8 0-11z"
          fill={`url(#${g})`}
        />
        <ellipse cx="25" cy="44" rx="3.2" ry="4" fill="#1c1917" />
        <ellipse cx="39" cy="44" rx="3.2" ry="4" fill="#1c1917" />
        <circle cx="26" cy="42.6" r="1.1" fill="#fff" />
        <circle cx="40" cy="42.6" r="1.1" fill="#fff" />
        <path d="M27 51q5 4 10 0" stroke="#1c1917" stroke-width="2.2" fill="none" stroke-linecap="round" />
        <circle cx="19" cy="49" r="2.6" fill="#f43f5e" opacity=".45" />
        <circle cx="45" cy="49" r="2.6" fill="#f43f5e" opacity=".45" />
      </svg>
    );
  }

  if (persona === 'phare') {
    return (
      <svg {...common}>
        {title ? <title>{title}</title> : null}
        <defs>
          <radialGradient id={g} cx=".35" cy=".3" r=".9">
            <stop offset="0" stop-color="#bae6fd" />
            <stop offset=".5" stop-color="#38bdf8" />
            <stop offset="1" stop-color="#1d4ed8" />
          </radialGradient>
        </defs>
        <path d="M22 6h20l-2 6H24z" fill="#fbbf24" />
        <path d="M14 9l8 2M50 9l-8 2" stroke="#fde68a" stroke-width="2.5" stroke-linecap="round" />
        <path d="M20 14h24l5 44H15z" fill={`url(#${g})`} />
        <path d="M18.6 28h26.8l1 8H17.6zM16.8 46h30.4l.9 6H15.9z" fill="#f8fafc" opacity=".9" />
        <ellipse cx="27" cy="22" rx="2.8" ry="3.4" fill="#0b1220" />
        <ellipse cx="37" cy="22" rx="2.8" ry="3.4" fill="#0b1220" />
        <circle cx="27.8" cy="20.8" r="1" fill="#fff" />
        <circle cx="37.8" cy="20.8" r="1" fill="#fff" />
        <path d="M29 39q3 2.5 6 0" stroke="#0b1220" stroke-width="2" fill="none" stroke-linecap="round" />
      </svg>
    );
  }

  if (persona === 'rustine') {
    return (
      <svg {...common}>
        {title ? <title>{title}</title> : null}
        <defs>
          <radialGradient id={g} cx=".35" cy=".3" r=".9">
            <stop offset="0" stop-color="#ccfbf1" />
            <stop offset=".5" stop-color="#2dd4bf" />
            <stop offset="1" stop-color="#0f766e" />
          </radialGradient>
        </defs>
        <rect x="8" y="12" width="48" height="40" rx="14" fill={`url(#${g})`} transform="rotate(-8 32 32)" />
        <rect
          x="14"
          y="18"
          width="36"
          height="28"
          rx="9"
          fill="none"
          stroke="#f0fdfa"
          stroke-width="1.8"
          stroke-dasharray="3.5 3"
          transform="rotate(-8 32 32)"
          opacity=".85"
        />
        <ellipse cx="25" cy="31" rx="3" ry="3.6" fill="#042f2e" />
        <ellipse cx="39" cy="29" rx="3" ry="3.6" fill="#042f2e" />
        <circle cx="25.8" cy="29.8" r="1" fill="#fff" />
        <circle cx="39.8" cy="27.8" r="1" fill="#fff" />
        <path d="M27 39q6 3 11-1" stroke="#042f2e" stroke-width="2.2" fill="none" stroke-linecap="round" />
        <path d="M50 8l4 4M54 8l-4 4" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      {title ? <title>{title}</title> : null}
      <defs>
        <radialGradient id={g} cx=".35" cy=".3" r=".9">
          <stop offset="0" stop-color="#ede9fe" />
          <stop offset=".5" stop-color="#a78bfa" />
          <stop offset="1" stop-color="#6d28d9" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="36" r="22" fill={`url(#${g})`} />
      <path d="M40 4c10 6 10 18 0 26l-6 4c2-8 2-16 6-30z" fill="#f5f3ff" />
      <path d="M40 6l-5 27" stroke="#c4b5fd" stroke-width="1.5" />
      <ellipse cx="25" cy="38" rx="3" ry="3.6" fill="#1e1036" />
      <ellipse cx="38" cy="38" rx="3" ry="3.6" fill="#1e1036" />
      <circle cx="25.8" cy="36.8" r="1" fill="#fff" />
      <circle cx="38.8" cy="36.8" r="1" fill="#fff" />
      <path d="M27 46q4.5 3 9 0" stroke="#1e1036" stroke-width="2.2" fill="none" stroke-linecap="round" />
    </svg>
  );
}
