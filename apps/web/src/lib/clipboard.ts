/**
 * Copie du texte dans le presse-papiers.
 * `navigator.clipboard` n'existe qu'en contexte sécurisé (HTTPS / localhost) :
 * sur un accès HTTP LAN (ex. http://10.1.0.88) on repasse par une textarea cachée
 * + `document.execCommand('copy')`.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && (typeof window === 'undefined' || window.isSecureContext !== false)) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission refusée : on tente le repli.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  // ≥ 16 px : pas de zoom iOS au focus de la textarea temporaire.
  ta.style.fontSize = '16px';
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  active?.focus?.({ preventScroll: true });
  return ok;
}
