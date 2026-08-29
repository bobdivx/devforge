import type { AgentChatStep } from './domain-api';
import type { ApplicationDockTabId } from './application-dock';

export const SPOTLIGHT_STORAGE_KEY = 'df-spotlight';
export const SPOTLIGHT_EVENT = 'devforge-spotlight-tab';

export type SpotlightTabEventDetail = {
    tab: ApplicationDockTabId;
};

const DEPLOY_HINTS = ['deploy', 'start', 'stop', 'restart', 'nixpacks', 'docker'];
const LOG_HINTS = ['logs', 'log'];
const ENV_HINTS = ['env', 'variable', 'secret'];

function normalizeToolName(name: string): string {
    return name.trim().toLowerCase();
}

function matchesHint(normalized: string, hint: string): boolean {
    if (normalized === hint) {
        return true;
    }

    if (normalized.includes(hint)) {
        if (hint === 'log' && (normalized.includes('login') || normalized.includes('logic') || normalized.includes('catalog'))) {
            return false;
        }

        return true;
    }

    return false;
}

/**
 * Mappe un nom d’outil agent vers l’onglet dock à ouvrir.
 * Retourne null si l’outil n’a pas de cible workspace claire.
 */
export function spotlightTabForTool(name: string): ApplicationDockTabId | null {
    const normalized = normalizeToolName(name);

    if (normalized === '') {
        return null;
    }

    if (LOG_HINTS.some((hint) => matchesHint(normalized, hint))) {
        return 'logs';
    }

    if (ENV_HINTS.some((hint) => matchesHint(normalized, hint))) {
        return 'variables';
    }

    if (DEPLOY_HINTS.some((hint) => matchesHint(normalized, hint))) {
        return 'deployments';
    }

    return null;
}

export function spotlightTabForSteps(steps: AgentChatStep[] | null | undefined): ApplicationDockTabId | null {
    if (!steps || steps.length === 0) {
        return null;
    }

    const running = [...steps].reverse().find((step) => step.status === 'running');
    if (running) {
        const runningTab = spotlightTabForTool(running.name);
        if (runningTab) {
            return runningTab;
        }
    }

    for (let index = steps.length - 1; index >= 0; index -= 1) {
        const tab = spotlightTabForTool(steps[index]!.name);
        if (tab) {
            return tab;
        }
    }

    return null;
}

export function readSpotlightEnabled(): boolean {
    if (typeof window === 'undefined') {
        return true;
    }

    try {
        return window.localStorage.getItem(SPOTLIGHT_STORAGE_KEY) !== '0';
    } catch {
        return true;
    }
}

export function writeSpotlightEnabled(enabled: boolean): void {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(SPOTLIGHT_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
        // ignore quota / private mode
    }
}

export function emitSpotlightTab(tab: ApplicationDockTabId): void {
    if (typeof window === 'undefined' || !readSpotlightEnabled()) {
        return;
    }

    window.dispatchEvent(new CustomEvent(SPOTLIGHT_EVENT, { detail: { tab } }));
}

export function emitSpotlightFromSteps(steps: AgentChatStep[] | null | undefined): ApplicationDockTabId | null {
    const tab = spotlightTabForSteps(steps);
    if (tab) {
        emitSpotlightTab(tab);
    }

    return tab;
}
