export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';
export type PageWidth = 'full' | 'center';
export type ZoomLevel = '100' | '90';

const THEME_STORAGE_KEY = 'devforge-theme';
const WIDTH_STORAGE_KEY = 'devforge-page-width';
const ZOOM_STORAGE_KEY = 'devforge-zoom';

export type AppearancePreferences = {
    theme: ThemePreference;
    pageWidth: PageWidth;
    zoom: ZoomLevel;
};

function resolveTheme(preference: ThemePreference): Theme {
    if (preference === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    return preference;
}

export function getStoredThemePreference(): ThemePreference {
    if (typeof window === 'undefined') {
        return 'system';
    }

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') {
        return storedTheme;
    }

    return 'system';
}

export function getInitialTheme(): Theme {
    return resolveTheme(getStoredThemePreference());
}

export function getAppearancePreferences(): AppearancePreferences {
    if (typeof window === 'undefined') {
        return { theme: 'system', pageWidth: 'full', zoom: '100' };
    }

    const pageWidth = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    const zoom = window.localStorage.getItem(ZOOM_STORAGE_KEY);

    return {
        theme: getStoredThemePreference(),
        pageWidth: pageWidth === 'center' ? 'center' : 'full',
        zoom: zoom === '90' ? '90' : '100',
    };
}

export function applyTheme(theme: Theme): void {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;

    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', theme === 'dark' ? '#0c0f0d' : '#f3f5f2');
}

export function applyAppearance(preferences: AppearancePreferences): Theme {
    window.localStorage.setItem(THEME_STORAGE_KEY, preferences.theme);
    window.localStorage.setItem(WIDTH_STORAGE_KEY, preferences.pageWidth);
    window.localStorage.setItem(ZOOM_STORAGE_KEY, preferences.zoom);

    const resolvedTheme = resolveTheme(preferences.theme);
    applyTheme(resolvedTheme);

    document.documentElement.dataset.devforgeWidth = preferences.pageWidth;
    document.documentElement.dataset.devforgeZoom = preferences.zoom;
    document.documentElement.style.setProperty('--devforge-ui-zoom', preferences.zoom === '90' ? '0.9' : '1');

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('devforge-appearance-changed'));
    }

    return resolvedTheme;
}

export function applyStoredAppearance(): Theme {
    return applyAppearance(getAppearancePreferences());
}

export function setThemePreference(preference: ThemePreference): Theme {
    return applyAppearance({
        ...getAppearancePreferences(),
        theme: preference,
    });
}

export function toggleResolvedTheme(current: Theme): Theme {
    const nextTheme: Theme = current === 'dark' ? 'light' : 'dark';
    applyAppearance({
        ...getAppearancePreferences(),
        theme: nextTheme,
    });

    return nextTheme;
}

export function contentWidthClass(pageWidth: PageWidth): string {
    return pageWidth === 'center' ? 'max-w-5xl' : 'max-w-7xl';
}
