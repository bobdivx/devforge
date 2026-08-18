import { describe, expect, it, vi } from 'vitest';
import {
    formatInstanceUpgradeElapsed,
    instanceUpgradeLabel,
    instanceUpgradeProgressPercent,
    instanceUpgradeReviveMessage,
    instanceUpgradeUiStep,
    mapInstanceUpgradeStepToUi,
    notifyInstanceUpgradeChanged,
    shouldShowInstanceUpgrade,
    INSTANCE_UPGRADE_CHANGED_EVENT,
} from '../src/lib/instance-upgrade';
import type { InstanceUpgradeStatus } from '../src/lib/domain-api';

function status(overrides: Partial<InstanceUpgradeStatus> = {}): InstanceUpgradeStatus {
    return {
        available: false,
        current_version: '4.0.0-beta.998',
        latest_version: '4.0.0-beta.999',
        status: 'none',
        step: 0,
        message: null,
        ...overrides,
    };
}

describe('instance-upgrade', () => {
    it('affiche l’indicateur seulement si une mise à jour ou un suivi est actif', () => {
        expect(shouldShowInstanceUpgrade(null)).toBe(false);
        expect(shouldShowInstanceUpgrade(status())).toBe(false);
        expect(shouldShowInstanceUpgrade(status({ available: true }))).toBe(true);
        expect(shouldShowInstanceUpgrade(status({ status: 'in_progress', step: 2 }))).toBe(true);
        expect(shouldShowInstanceUpgrade(status({ status: 'complete', step: 6 }))).toBe(true);
        expect(shouldShowInstanceUpgrade(status({ status: 'error' }))).toBe(true);
    });

    it('calcule la progression et le libellé', () => {
        expect(instanceUpgradeProgressPercent(status({ status: 'in_progress', step: 3 }))).toBe(50);
        expect(instanceUpgradeProgressPercent(status({ status: 'complete', step: 6 }))).toBe(100);
        expect(instanceUpgradeLabel(status({ available: true }))).toBe('Mise à jour 4.0.0-beta.999');
        expect(instanceUpgradeLabel(status({ status: 'in_progress' }))).toBe('Mise à jour…');
        expect(instanceUpgradeLabel(status({ status: 'error' }))).toBe('Échec de la mise à jour');
    });

    it('mappe les étapes backend vers le stepper UI', () => {
        expect(mapInstanceUpgradeStepToUi(0)).toBe(0);
        expect(mapInstanceUpgradeStepToUi(1)).toBe(1);
        expect(mapInstanceUpgradeStepToUi(2)).toBe(1);
        expect(mapInstanceUpgradeStepToUi(3)).toBe(2);
        expect(mapInstanceUpgradeStepToUi(4)).toBe(3);
        expect(mapInstanceUpgradeStepToUi(5)).toBe(3);
        expect(mapInstanceUpgradeStepToUi(6)).toBe(4);
        expect(instanceUpgradeUiStep({ starting: true })).toBe(1);
        expect(instanceUpgradeUiStep({ unreachable: true })).toBe(4);
        expect(instanceUpgradeUiStep({ complete: true })).toBe(5);
    });

    it('formate le temps écoulé et les messages de reprise', () => {
        expect(formatInstanceUpgradeElapsed(0)).toBe('0:00');
        expect(formatInstanceUpgradeElapsed(75)).toBe('1:15');
        expect(instanceUpgradeReviveMessage(0, 3)).toContain('tentative 3');
        expect(instanceUpgradeReviveMessage(3, 10)).toContain('plusieurs minutes');
        expect(instanceUpgradeReviveMessage(12, 40)).toContain('logs serveur');
    });

    it('émet un événement de synchronisation', () => {
        const listener = vi.fn();
        window.addEventListener(INSTANCE_UPGRADE_CHANGED_EVENT, listener);
        notifyInstanceUpgradeChanged();
        expect(listener).toHaveBeenCalledOnce();
        window.removeEventListener(INSTANCE_UPGRADE_CHANGED_EVENT, listener);
    });
});
