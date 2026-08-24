import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamContext } from '../src/lib/team-context';
import { DockerPage } from '../src/pages/docker/_DockerPage';
import type { DockerContainersResponse, DockerImagesResponse } from '../src/lib/domain-api';

const dockerContainers = vi.fn();
const dockerContainerAction = vi.fn();
const dockerImages = vi.fn();
const dockerCheckImageUpdates = vi.fn();
const dockerUpdateImage = vi.fn();
const dockerUpdateAllImages = vi.fn();
const dockerToggleAutoUpdate = vi.fn();

vi.mock('../src/lib/domain-api', () => ({
    domainApi: {
        dockerContainers: (...args: unknown[]) => dockerContainers(...args),
        dockerContainerAction: (...args: unknown[]) => dockerContainerAction(...args),
        dockerImages: (...args: unknown[]) => dockerImages(...args),
        dockerCheckImageUpdates: (...args: unknown[]) => dockerCheckImageUpdates(...args),
        dockerUpdateImage: (...args: unknown[]) => dockerUpdateImage(...args),
        dockerUpdateAllImages: (...args: unknown[]) => dockerUpdateAllImages(...args),
        dockerToggleAutoUpdate: (...args: unknown[]) => dockerToggleAutoUpdate(...args),
    },
}));

function mockContainersData(): DockerContainersResponse {
    return {
        data: [
            {
                ID: 'abc123def456',
                Names: 'coolify-testing',
                Image: 'nginx:alpine',
                State: 'running',
                Status: 'Up 2 hours',
                Ports: '0.0.0.0:80->80/tcp',
                RunningFor: '2 hours',
                CreatedAt: '2026-08-24 06:00:00',
                Labels: 'devforge.managed=true',
            },
            {
                ID: 'xyz789uvw012',
                Names: 'standalone-redis',
                Image: 'redis:7',
                State: 'exited',
                Status: 'Exited (0) 10 minutes ago',
                Ports: '',
                RunningFor: '10 minutes ago',
                CreatedAt: '2026-08-24 05:00:00',
                Labels: '',
            },
        ],
        meta: {
            server: {
                uuid: 'server-1',
                name: 'Local Server',
                ip: '127.0.0.1',
                is_functional: true,
            },
            total: 2,
            running: 1,
            exited: 1,
        },
    };
}

function mockImagesData(): DockerImagesResponse {
    return {
        data: {
            applications: [
                {
                    uuid: 'app-1',
                    name: 'My Web App',
                    type: 'application',
                    image: 'ghcr.io/org/app',
                    tag: 'latest',
                    is_image_auto_update_enabled: true,
                    project: 'Demo Project',
                    environment: 'production',
                    server: 'Local Server',
                    status: 'running',
                },
            ],
            services: [
                {
                    uuid: 'svc-1',
                    name: 'Wordpress Stack',
                    type: 'service',
                    image: null,
                    tag: null,
                    is_image_auto_update_enabled: false,
                    project: 'Demo Project',
                    environment: 'production',
                    server: 'Local Server',
                    status: 'running',
                },
            ],
        },
        meta: {
            total: 2,
            auto_update_enabled: 1,
        },
    };
}

function renderPage() {
    return render(
        <TeamContext.Provider value={{ teamId: 1, revision: 1, agentsEnabled: true }}>
            <DockerPage />
        </TeamContext.Provider>,
    );
}

describe('DockerPage', () => {
    beforeEach(() => {
        dockerContainers.mockReset();
        dockerContainerAction.mockReset();
        dockerImages.mockReset();
        dockerCheckImageUpdates.mockReset();
        dockerUpdateImage.mockReset();
        dockerUpdateAllImages.mockReset();
        dockerToggleAutoUpdate.mockReset();

        dockerContainers.mockResolvedValue(mockContainersData());
        dockerImages.mockResolvedValue(mockImagesData());
    });

    afterEach(() => {
        cleanup();
    });

    it('renders docker page with stats and containers table', async () => {
        renderPage();

        await waitFor(() => {
            expect(screen.getByText('coolify-testing')).toBeTruthy();
            expect(screen.getByText('standalone-redis')).toBeTruthy();
            expect(screen.getByText('Total Conteneurs')).toBeTruthy();
        });
    });

    it('filters containers by search query', async () => {
        renderPage();

        await waitFor(() => {
            expect(screen.getByText('coolify-testing')).toBeTruthy();
        });

        const searchInput = screen.getByPlaceholderText('Rechercher par nom, image ou ID...');
        fireEvent.input(searchInput, { target: { value: 'redis' } });

        await waitFor(() => {
            expect(screen.queryByText('coolify-testing')).toBeNull();
            expect(screen.getByText('standalone-redis')).toBeTruthy();
        });
    });

    it('switches to images tab and displays docker applications with auto update toggle', async () => {
        renderPage();

        await waitFor(() => {
            expect(screen.getByText('coolify-testing')).toBeTruthy();
        });

        const imagesTabButton = screen.getByText(/Mises à jour des images/i);
        fireEvent.click(imagesTabButton);

        await waitFor(() => {
            expect(screen.getByText('My Web App')).toBeTruthy();
            expect(screen.getByText('Wordpress Stack')).toBeTruthy();
            expect(screen.getByText('ghcr.io/org/app:latest')).toBeTruthy();
        });
    });

    it('toggles auto update when switch is clicked', async () => {
        dockerToggleAutoUpdate.mockResolvedValue({
            message: 'Configuration mise à jour.',
            data: { uuid: 'svc-1', is_image_auto_update_enabled: true },
        });

        renderPage();

        await waitFor(() => {
            expect(screen.getByText('coolify-testing')).toBeTruthy();
        });

        const imagesTabButton = screen.getByText(/Mises à jour des images/i);
        fireEvent.click(imagesTabButton);

        await waitFor(() => {
            expect(screen.getByText('Wordpress Stack')).toBeTruthy();
        });

        const toggles = screen.getAllByRole('checkbox');
        expect(toggles.length).toBe(2);

        // Click the second toggle (Wordpress Stack)
        fireEvent.click(toggles[1]);

        await waitFor(() => {
            expect(dockerToggleAutoUpdate).toHaveBeenCalledWith('service', 'svc-1', true);
        });
    });
});
