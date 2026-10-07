import { useEffect, useState } from 'preact/hooks';
import { PersonaAvatar } from './personas/PersonaAvatar';

const KEY = 'df-android-banner-dismissed';

/** Bandeau discret, seulement sur un navigateur Android : l'app native existe. */
export function AndroidAppBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const android = /Android/i.test(navigator.userAgent);
      // Déjà dans l'app (WebView / Custom Tab de l'app) : rien à proposer.
      const inApp = /DevForgeAndroid/i.test(navigator.userAgent);
      setShow(android && !inApp && localStorage.getItem(KEY) !== '1');
    } catch {
      setShow(false);
    }
  }, []);
  if (!show) return null;
  return (
    <div class="df-tap mb-4 flex items-center gap-3 rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] px-3 py-2.5">
      <PersonaAvatar persona="braise" size={36} />
      <a href="/app/android" class="min-w-0 flex-1">
        <p class="text-sm font-medium">📱 DevForge existe en app Android</p>
        <p class="truncate text-xs text-[var(--color-ink-muted)]">Alertes et Braise dans ta poche. Installer →</p>
      </a>
      <button
        type="button"
        aria-label="Masquer"
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--color-ink-muted)] hover:bg-white/5"
        onClick={() => {
          try {
            localStorage.setItem(KEY, '1');
          } catch {
            /* stockage indisponible */
          }
          setShow(false);
        }}
      >
        ✕
      </button>
    </div>
  );
}
