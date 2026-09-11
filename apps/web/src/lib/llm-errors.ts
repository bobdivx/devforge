/**
 * Utilitaire pour afficher les erreurs LLM humanisées côté frontend.
 * 
 * Note : Le backend Rust (crates/llm/src/errors.rs) normalise déjà
 * les erreurs avant stockage dans `last_probe_error`. Ce module offre
 * une couche supplémentaire de formatage pour l'affichage UI si nécessaire.
 */

const MAX_DISPLAY_LENGTH = 80;

/**
 * Formate une erreur LLM pour l'affichage dans l'interface.
 * 
 * @param error - Message d'erreur (déjà humanisé par le backend normalement)
 * @param truncate - Tronquer si > MAX_DISPLAY_LENGTH (défaut: true)
 * @returns Message formaté pour l'affichage
 */
export function formatLlmError(error: string | undefined, truncate = true): string {
  if (!error || error.trim() === '') {
    return 'Erreur inconnue';
  }

  let formatted = error.trim();

  // Si le backend a déjà humanisé, on affiche tel quel (ou tronqué)
  if (truncate && formatted.length > MAX_DISPLAY_LENGTH) {
    return formatted.slice(0, MAX_DISPLAY_LENGTH - 3) + '...';
  }

  return formatted;
}

/**
 * Extrait un badge tone pour une erreur LLM.
 * 
 * @param error - Message d'erreur
 * @returns Tone du badge ('danger' pour erreurs critiques, 'warn' pour temporaires)
 */
export function getLlmErrorTone(error: string | undefined): 'danger' | 'warn' {
  if (!error) return 'danger';

  const lower = error.toLowerCase();

  // Erreurs temporaires / rate limit = warn
  if (
    lower.includes('quota') ||
    lower.includes('trop de requêtes') ||
    lower.includes('réessaie') ||
    lower.includes('injoignable')
  ) {
    return 'warn';
  }

  // Erreurs permanentes (clé invalide, modèle introuvable) = danger
  return 'danger';
}

/**
 * Vérifie si une erreur suggère un problème temporaire (retry possible).
 */
export function isTemporaryError(error: string | undefined): boolean {
  if (!error) return false;

  const lower = error.toLowerCase();
  return (
    lower.includes('quota') ||
    lower.includes('trop de requêtes') ||
    lower.includes('réessaie') ||
    lower.includes('injoignable')
  );
}
