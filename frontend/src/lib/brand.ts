import { DEVFORGE_BASE_PATH } from './routes';

export const DEVFORGE_BRAND_NAME = 'DevForge';

function brandAssetUrl(relativePath: string): string {
    return `${DEVFORGE_BASE_PATH}/${relativePath}`.replace(/\/{2,}/g, '/');
}

/** Logo embarqué dans le build (`brand/logo.png` sous la base SPA). */
export const DEVFORGE_LOGO_URL = brandAssetUrl('brand/logo.png');

/** Favicon à la racine d’origine (`/favicon.ico`) — Chrome le demande toujours. */
export const DEVFORGE_FAVICON_URL = brandAssetUrl('favicon.ico');