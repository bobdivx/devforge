import { routeHref } from './routes';

/**
 * Navigue en SPA sans rechargement.
 * pushState + dispatch popstate pour que App.tsx mette à jour son état.
 */
export function navigateTo(targetPath: string): void {
    window.history.pushState({}, '', routeHref(targetPath));
    window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useNavigate() {
    return (event: MouseEvent, targetPath: string): void => {
        if (
            event.defaultPrevented
            || event.button !== 0
            || event.metaKey
            || event.ctrlKey
            || event.shiftKey
            || event.altKey
        ) {
            return;
        }
        event.preventDefault();
        navigateTo(targetPath);
    };
}
