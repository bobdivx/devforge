/**
 * Construit une URL vers l'interface Coolify d'origine (Livewire).
 * Le paramètre `legacy=1` contourne la redirection DevForge côté serveur.
 */
export function legacyCoolifyUrl(baseUrl: string, path = '/'): string {
    if (!baseUrl) {
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        return `${normalizedPath}?legacy=1`;
    }

    const url = new URL(path, `${baseUrl.replace(/\/$/, '')}/`);
    url.searchParams.set('legacy', '1');

    return url.toString();
}
