import { DEVFORGE_BASE_PATH } from './routes';

export const DEVFORGE_BRAND_NAME = 'DevForge';

/** Logo embarqué dans le build (`brand/logo.png` sous la base SPA). */
export const DEVFORGE_LOGO_URL = `${DEVFORGE_BASE_PATH}/brand/logo.png`.replace(/\/{2,}/g, '/');