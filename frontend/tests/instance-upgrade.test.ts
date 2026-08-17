import { describe, expect, it } from 'vitest';
import {
    instanceUpgradeLabel,
    instanceUpgradeProgressPercent,
    shouldShowInstanceUpgrade,
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
});
