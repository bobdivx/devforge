import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstanceUpdateIndicator } from '../src/components/InstanceUpdateIndicator';
import { domainApi, type InstanceUpgradeStatus } from '../src/lib/domain-api';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const available: InstanceUpgradeStatus = {
    available: true,
    current_version: '4.0.0-beta.998',
    latest_version: '4.0.0-beta.999',
    status: 'none',
    step: 0,
    message: null,
};

describe('InstanceUpdateIndicator', () => {
    it('ne rend rien sans permission ou sans mise à jour', async () => {
        const status = vi.spyOn(domainApi, 'instanceUpgradeStatus');
        const { container } = render(<InstanceUpdateIndicator enabled={false} />);

        expect(container.textContent).toBe('');
        expect(status).not.toHaveBeenCalled();
    });

    it('affiche un bouton pour lancer la mise à jour disponible', async () => {
        vi.spyOn(domainApi, 'instanceUpgradeStatus').mockResolvedValue({ data: available });
        const start = vi.spyOn(domainApi, 'startInstanceUpgrade').mockResolvedValue({
            data: { ...available, status: 'in_progress', step: 1, message: 'Starting upgrade...' },
        });

        render(<InstanceUpdateIndicator enabled />);

        const trigger = await screen.findByRole('button', { name: 'Mise à jour 4.0.0-beta.999' });
        fireEvent.click(trigger);

        expect(await screen.findByText('Mettre à jour DevForge ?')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour maintenant' }));

        await waitFor(() => {
            expect(start).toHaveBeenCalledOnce();
        });
    });
});
