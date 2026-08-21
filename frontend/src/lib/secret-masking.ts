/**
 * Masque les secrets sensibles dans les chaînes de texte.
 * 
 * Cible les motifs suivants:
 * - Tokens Bearer: Bearer xxx, BEARER_TOKEN=xxx
 * - API Keys: API_KEY=xxx, api-key=xxx
 * - Tokens génériques: TOKEN=xxx, token=xxx
 * - Mots de passe: PASSWORD=xxx, password=xxx
 * - Secrets: SECRET=xxx, secret=xxx
 */
export function maskSecretsInText(text: string | null | undefined): string {
    if (!text) {
        return '';
    }

    // Bearer tokens: Bearer xxx ou bearer xxx
    let masked = text.replace(
        /\b(bearer)\s+([a-z0-9\-._~+/]+)/gi,
        (_, prefix) => `${prefix} ••••••`,
    );

    // Variables d'environnement avec secrets (insensible à la casse)
    // Format: KEY=value ou KEY="value" ou KEY='value'
    const secretPatterns = [
        /(api[_-]?key|token|password|passwd|secret|bearer[_-]?token|auth[_-]?token|access[_-]?token|jwt)/i,
    ];

    for (const pattern of secretPatterns) {
        // Format: KEY=value (sans guillemets)
        masked = masked.replace(
            new RegExp(`(${pattern.source})\\s*=\\s*([^\\s'"]+)`, 'gi'),
            '$1=••••••',
        );
        // Format: KEY="value" ou KEY='value'
        masked = masked.replace(
            new RegExp(`(${pattern.source})\\s*=\\s*["']([^"']+)["']`, 'gi'),
            '$1="••••••"',
        );
    }

    return masked;
}

/**
 * Vérifie si le texte contient potentiellement des secrets.
 */
export function containsPotentialSecret(text: string | null | undefined): boolean {
    if (!text) {
        return false;
    }

    const patterns = [
        /\bbearer\s+[a-z0-9\-._~+/]+/i,
        /(api[_-]?key|token|password|passwd|secret|bearer[_-]?token|auth[_-]?token|access[_-]?token|jwt)\s*=\s*[^\s'"]+/i,
        /(api[_-]?key|token|password|passwd|secret|bearer[_-]?token|auth[_-]?token|access[_-]?token|jwt)\s*=\s*["'][^"']+["']/i,
    ];

    return patterns.some((pattern) => pattern.test(text));
}
