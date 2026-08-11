import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeploymentAgentCard } from '../src/components/applications/DeploymentAgentCard';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('DeploymentAgentCard', () => {
    it('affiche les raisons longues des sous-agents sans les tronquer dans le DOM', async () => {
        const longReason = 'Récupérer les logs de déploiement et diagnostiquer la cause de l’échec.';

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.includes('/deployments/dep-1/monitoring')) {
                return jsonResponse({
                    data: {
                        deployment: {
                            uuid: 'dep-1',
                            status: 'in_progress',
                            commit: 'abc1234',
                            commit_message: 'fix build',
                            created_at: '2026-07-30T21:11:00.000Z',
                            finished_at: null,
                        },
                        agent_runs: [{
                            uuid: 'run-1',
                            status: 'running',
                            trigger: 'event',
                            summary: null,
                            actions_taken: [],
                            iterations: 1,
                            tokens_used: 0,
                            duration_seconds: null,
                            started_at: '2026-07-30T21:11:00.000Z',
                            finished_at: null,
                            created_at: '2026-07-30T21:11:00.000Z',
                            event_context: { event: 'deployment_build_started' },
                            metadata: {
                                ephemeral_tasks: [{
                                    model_label: 'Flash-Lite',
                                    goal: longReason,
                                    status: 'running',
                                }],
                            },
                            correction: {
                                outcome: 'in_progress',
                                headline: 'Intervention agent en cours…',
                                source_scope: 'current',
                                actions: [],
                                pills: [
                                    { id: 'env', label: 'Env Coolify', active: false },
                                    { id: 'build', label: 'Build', active: true },
                                ],
                            },
                            subagent_runs: [{
                                uuid: 'sub-1',
                                status: 'completed',
                                reason: longReason,
                                output: null,
                                error: null,
                                started_at: '2026-07-30T21:11:00.000Z',
                                finished_at: '2026-07-30T21:11:30.000Z',
                                child_agent: {
                                    uuid: 'child-1',
                                    name: 'Build',
                                    type: 'deployment',
                                    avatar_color: '#22c55e',
                                },
                                child_run: {
                                    uuid: 'child-run-1',
                                    status: 'completed',
                                    summary: null,
                                },
                            }],
                            logs: 'line 1',
                            linkage: 'direct',
                            agent: {
                                uuid: 'agent-1',
                                name: 'Build',
                                type: 'deployment',
                                avatar_color: '#22c55e',
                            },
                        }],
                        redeployments: [],
                        agents: {
                            enabled: true,
                            auto_fix_deployments: true,
                            monitor_build: true,
                            webhook_build: true,
                        },
                        diagnostics: {
                            blockers: [],
                            eligible_agents_count: 1,
                            active_agents_count: 1,
                            agents_with_provider_count: 1,
                            agents_busy_count: 0,
                            team_has_llm_provider: true,
                        },
                    },
                });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(<DeploymentAgentCard deploymentUuid="dep-1" pollWhileActive={false} />);

        await waitFor(() => {
            expect(screen.getByText('Sous-agents')).toBeInTheDocument();
        });

        const reasonMatches = screen.getAllByText(longReason);
        expect(reasonMatches.length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText('Flash-Lite')).toBeInTheDocument();
        expect(screen.getByText('Intervention agent en cours…')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Logs' })).toBeInTheDocument();
    });

    it('affiche un message de redéploiement long sans élargir le conteneur', async () => {
        const longCommitMessage = 'fix(deploy): forcer Node 24 pour Astro 7 sur Nixpacks/DevForgeCoolify-astro-site';

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.includes('/deployments/dep-2/monitoring')) {
                return jsonResponse({
                    data: {
                        deployment: {
                            uuid: 'dep-2',
                            status: 'failed',
                            commit: 'def5678',
                            commit_message: 'build failed',
                            created_at: '2026-07-30T21:11:00.000Z',
                            finished_at: '2026-07-30T21:12:00.000Z',
                        },
                        agent_runs: [],
                        redeployments: [{
                            uuid: 'dep-redeploy',
                            status: 'in_progress',
                            commit: 'abc1234',
                            commit_message: longCommitMessage,
                            created_at: '2026-07-30T21:13:00.000Z',
                            finished_at: null,
                        }],
                        agents: {
                            enabled: true,
                            auto_fix_deployments: true,
                            monitor_build: true,
                            webhook_build: true,
                        },
                        diagnostics: {
                            blockers: [],
                            eligible_agents_count: 1,
                            active_agents_count: 1,
                            agents_with_provider_count: 1,
                            agents_busy_count: 0,
                            team_has_llm_provider: true,
                        },
                    },
                });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(<DeploymentAgentCard deploymentUuid="dep-2" pollWhileActive={false} />);

        const message = await screen.findByText(longCommitMessage);
        expect(message.className).toContain('break-words');
        expect(message.className).toContain('[overflow-wrap:anywhere]');

        const redeployButton = message.closest('button');
        expect(redeployButton).not.toBeNull();
        expect(redeployButton?.className).toContain('min-w-0');
        expect(redeployButton?.className).toContain('max-w-full');
        expect(redeployButton?.className).toContain('overflow-hidden');
        expect(screen.getByText('Redéploiements')).toBeInTheDocument();
    });
});
