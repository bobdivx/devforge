import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api-client';
import { domainApi, type InstanceUpgradeStatus } from '../src/lib/domain-api';
import { notifyInstanceUpgradeChanged } from '../src/lib/instance-upgrade';
import { useInstanceUpgrade } from '../src/lib/use-instance-upgrade';

const available: InstanceUpgradeStatus = {
    available: true,
    current_version: '4.0.0-beta.998',
    latest_version: '4.0.0-beta.999',
    status: 'none',
    step: 0,
    message: null,
};

function Probe({
    onReload,
    checkHealth,
}: {
    onReload?: () => void;
    checkHealth?: () => Promise<boolean>;
}) {
    const upgrade = useInstanceUpgrade({ enabled: true, onReload, checkHealth });

    return (
        <div>
            <span data-testid="phase">{upgrade.phase}</span>
            <span data-testid="message">{upgrade.message ?? ''}</span>
            <span data-testid="ui-step">{upgrade.uiStep}</span>
            <span data-testid="countdown">{upgrade.successCountdown ?? ''}</span>
            <button type="button" onClick={() => void upgrade.start()}>start</button>
            <button type="button" onClick={upgrade.reloadNow}>reload-now</button>
        </div>
    );
}

describe('useInstanceUpgrade', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    async function flush(): Promise<void> {
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    it('ne recharge pas si un statut complete est déjà présent au chargement', async () => {
        const onReload = vi.fn();
        vi.spyOn(domainApi, 'instanceUpgradeStatus').mockResolvedValue({
            data: { ...available, status: 'complete', step: 6, message: 'Upgrade complete' },
        });

        render(<Probe onReload={onReload} />);
        await flush();

        expect(screen.getByTestId('phase').textContent).toBe('idle');
        expect(onReload).not.toHaveBeenCalled();
    });

    it('compte à rebours puis recharge après une mise à jour réussie', async () => {
        const onReload = vi.fn();
        vi.spyOn(domainApi, 'instanceUpgradeStatus').mockResolvedValue({ data: available });
        vi.spyOn(domainApi, 'startInstanceUpgrade').mockResolvedValue({
            data: { ...available, status: 'complete', step: 6, message: 'Upgrade complete' },
        });

        render(<Probe onReload={onReload} />);
        await flush();

        fireEvent.click(screen.getByText('start'));
        await flush();

        expect(screen.getByTestId('phase').textContent).toBe('complete');
        expect(screen.getByTestId('countdown').textContent).toBe('3');
        expect(screen.getByTestId('message').textContent).toContain('4.0.0-beta.999');

        await act(async () => {
            vi.advanceTimersByTime(3000);
        });

        expect(onReload).toHaveBeenCalledOnce();
    });

    it('passe en vérification santé quand l’API tombe puis recharge', async () => {
        const onReload = vi.fn();
        const checkHealth = vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        let statusCalls = 0;
        vi.spyOn(domainApi, 'instanceUpgradeStatus').mockImplementation(async () => {
            statusCalls += 1;
            if (statusCalls === 1) {
                return { data: available };
            }

            throw new ApiError(0, { message: 'Impossible de joindre le serveur DevForge.' });
        });
        vi.spyOn(domainApi, 'startInstanceUpgrade').mockResolvedValue({
            data: { ...available, status: 'in_progress', step: 4, message: 'Stopping containers' },
        });

        render(<Probe onReload={onReload} checkHealth={checkHealth} />);
        await flush();

        fireEvent.click(screen.getByText('start'));
        await flush();
        expect(screen.getByTestId('phase').textContent).toBe('progress');
        expect(screen.getByTestId('ui-step').textContent).toBe('3');

        await act(async () => {
            vi.advanceTimersByTime(2000);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(screen.getByTestId('phase').textContent).toBe('reviving');
        expect(screen.getByTestId('message').textContent).toContain('retour de DevForge');

        await act(async () => {
            vi.advanceTimersByTime(2000);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(screen.getByTestId('phase').textContent).toBe('complete');
        expect(checkHealth).toHaveBeenCalledTimes(2);
    });

    it('recharge le statut quand une autre vue lance la mise à jour', async () => {
        const status = vi.spyOn(domainApi, 'instanceUpgradeStatus')
            .mockResolvedValueOnce({ data: available })
            .mockResolvedValue({
                data: { ...available, status: 'in_progress', step: 1, message: 'Starting upgrade...' },
            });

        render(<Probe />);
        await flush();
        expect(status).toHaveBeenCalledOnce();

        await act(async () => {
            notifyInstanceUpgradeChanged();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(status).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('phase').textContent).toBe('progress');
    });
});
