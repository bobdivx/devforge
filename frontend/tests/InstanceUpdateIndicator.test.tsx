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

    it('garde la modal ouverte avec les étapes après le lancement', async () => {
        vi.spyOn(domainApi, 'instanceUpgradeStatus').mockResolvedValue({ data: available });
        const start = vi.spyOn(domainApi, 'startInstanceUpgrade').mockResolvedValue({
            data: { ...available, status: 'in_progress', step: 3, message: 'Pulling Docker images' },
        });

        render(<InstanceUpdateIndicator enabled />);

        const trigger = await screen.findByRole('button', { name: 'Mise à jour 4.0.0-beta.999' });
        fireEvent.click(trigger);

        expect(await screen.findByText('Mettre à jour DevForge ?')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour maintenant' }));

        await waitFor(() => {
            expect(start).toHaveBeenCalledOnce();
        });

        expect(await screen.findByText('Mise à jour en cours…')).toBeInTheDocument();
        expect(screen.getByLabelText('Étapes de mise à jour')).toBeInTheDocument();
        expect(screen.getByText('Pulling Docker images')).toBeInTheDocument();
        expect(screen.getByText('Préparation')).toBeInTheDocument();
        expect(screen.getByText('Helper')).toBeInTheDocument();
        expect(screen.getByText('Image')).toBeInTheDocument();
        expect(screen.getByText('Redémarrage')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Fermer' })).not.toBeInTheDocument();
    });

    it('ouvre la progression si une mise à jour est déjà en cours', async () => {
        vi.spyOn(domainApi, 'instanceUpgradeStatus').mockResolvedValue({
            data: {
                ...available,
                status: 'in_progress',
                step: 5,
                message: 'Starting new containers',
            },
        });

        render(<InstanceUpdateIndicator enabled />);

        expect(await screen.findByText('Mise à jour en cours…')).toBeInTheDocument();
        expect(screen.getByText('Starting new containers')).toBeInTheDocument();
        expect(screen.getByText(/Temps écoulé/)).toBeInTheDocument();
    });

    it('affiche le rechargement après une mise à jour réussie', async () => {
        const onReload = vi.fn();
        vi.spyOn(domainApi, 'instanceUpgradeStatus').mockResolvedValue({ data: available });
        vi.spyOn(domainApi, 'startInstanceUpgrade').mockResolvedValue({
            data: { ...available, status: 'complete', step: 6, message: 'Upgrade complete' },
        });

        render(<InstanceUpdateIndicator enabled onReload={onReload} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Mise à jour 4.0.0-beta.999' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Mettre à jour maintenant' }));

        expect(await screen.findByText('Mise à jour terminée')).toBeInTheDocument();
        expect(screen.getByText(/Rechargement dans/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Recharger maintenant' }));
        expect(onReload).toHaveBeenCalledOnce();
    });
});
