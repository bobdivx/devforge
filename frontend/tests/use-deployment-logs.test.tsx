import { act, renderHook, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { domainApi, type ApiResponse, type DeploymentLogs } from '../src/lib/domain-api';
import { useDeploymentLogs } from '../src/lib/use-deployment-logs';

describe('useDeploymentLogs', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('ajoute les nouvelles lignes sans repasser en chargement', async () => {
        const deploymentLogs = vi.spyOn(domainApi, 'deploymentLogs')
            .mockResolvedValueOnce({
                data: {
                    items: [{ cursor: 1, stream: 'stdout', message: 'Étape 1', timestamp: null, command: false, hidden: false }],
                    next_cursor: 1,
                    complete: false,
                },
            })
            .mockResolvedValueOnce({
                data: {
                    items: [{ cursor: 2, stream: 'stdout', message: 'Étape 2', timestamp: null, command: false, hidden: false }],
                    next_cursor: 2,
                    complete: false,
                },
            });

        const { result } = renderHook(() => useDeploymentLogs('deployment-1', { intervalMs: 2000 }));

        await waitFor(() => expect(result.current.lines).toHaveLength(1));
        expect(result.current.loading).toBe(false);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
        });

        await waitFor(() => expect(result.current.lines).toHaveLength(2));
        expect(result.current.loading).toBe(false);
        expect(deploymentLogs).toHaveBeenNthCalledWith(1, 'deployment-1', 0);
        expect(deploymentLogs).toHaveBeenNthCalledWith(2, 'deployment-1', 1);
    });

    it('arrête le polling quand le déploiement est terminé', async () => {
        const deploymentLogs = vi.spyOn(domainApi, 'deploymentLogs')
            .mockResolvedValueOnce({
                data: {
                    items: [{ cursor: 1, stream: 'stdout', message: 'Terminé', timestamp: null, command: false, hidden: false }],
                    next_cursor: 1,
                    complete: true,
                },
            });

        const { result } = renderHook(() => useDeploymentLogs('deployment-1', { intervalMs: 2000 }));

        await waitFor(() => expect(result.current.complete).toBe(true));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(6000);
        });

        expect(deploymentLogs).toHaveBeenCalledTimes(1);
        expect(result.current.complete).toBe(true);
    });

    it('ignore une réponse stale quand on change de déploiement', async () => {
        let resolveOld: ((value: ApiResponse<DeploymentLogs>) => void) | null = null;

        const deploymentLogs = vi.spyOn(domainApi, 'deploymentLogs')
            .mockImplementationOnce(() => new Promise<ApiResponse<DeploymentLogs>>((resolve) => {
                resolveOld = resolve;
            }))
            .mockResolvedValueOnce({
                data: {
                    items: [{ cursor: 1, stream: 'stdout', message: 'Nouveau déploiement', timestamp: null, command: false, hidden: false }],
                    next_cursor: 1,
                    complete: false,
                },
            });

        const { result, rerender } = renderHook(
            ({ uuid }) => useDeploymentLogs(uuid, { intervalMs: 2000 }),
            { initialProps: { uuid: 'deployment-old' } },
        );

        await act(async () => {
            await Promise.resolve();
        });

        rerender({ uuid: 'deployment-new' });

        await waitFor(() => {
            expect(result.current.lines.map((line) => line.message)).toEqual(['Nouveau déploiement']);
        });

        await act(async () => {
            resolveOld?.({
                data: {
                    items: [{ cursor: 9, stream: 'stdout', message: 'Ancien déploiement', timestamp: null, command: false, hidden: false }],
                    next_cursor: 9,
                    complete: true,
                },
            });
            await Promise.resolve();
        });

        expect(result.current.lines.map((line) => line.message)).toEqual(['Nouveau déploiement']);
        expect(result.current.complete).toBe(false);
        expect(deploymentLogs).toHaveBeenCalledWith('deployment-new', 0);
    });
});
