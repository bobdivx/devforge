import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunnerGithubJobsPanel } from '../src/components/runners/RunnerGithubJobsPanel';
import type { GithubRunnerJobs } from '../src/lib/domain-api';

afterEach(() => {
    cleanup();
});

const payload: GithubRunnerJobs = {
    available: true,
    repo: 'bobdivx/popcorn-tauri',
    message: null,
    counts: { in_progress: 1, queued: 1, failure: 1 },
    items: [
        {
            id: '101',
            name: 'build-windows',
            workflow_name: 'Desktop',
            bucket: 'in_progress',
            status: 'in_progress',
            head_branch: 'main',
            html_url: 'https://github.com/bobdivx/popcorn-tauri/actions/runs/11/job/101',
            assigned: true,
            runner_name: 'devforge-runner-popcorn-tauri',
        },
        {
            id: '102',
            name: 'package',
            workflow_name: 'CI',
            bucket: 'queued',
            status: 'queued',
            head_branch: 'feat/x',
            assigned: false,
        },
        {
            id: '103',
            name: 'build-linux',
            workflow_name: 'Release',
            bucket: 'failure',
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://github.com/bobdivx/popcorn-tauri/actions/runs/13/job/103',
            assigned: true,
            runner_name: 'devforge-runner-popcorn-tauri',
        },
    ],
};

describe('RunnerGithubJobsPanel', () => {
    it('affiche les jobs en cours, en attente et en échec', () => {
        render(
            <RunnerGithubJobsPanel
                jobs={payload}
                loading={false}
                error={null}
                refreshing={false}
                onRetry={() => undefined}
            />,
        );

        expect(screen.getByText('Actions GitHub')).toBeTruthy();
        expect(screen.getByText('En cours (1)')).toBeTruthy();
        expect(screen.getByText('En attente (1)')).toBeTruthy();
        expect(screen.getByText('En échec (1)')).toBeTruthy();
        expect(screen.getByText('Desktop · build-windows')).toBeTruthy();
        expect(screen.getByText('CI · package')).toBeTruthy();
        expect(screen.getByText('Release · build-linux')).toBeTruthy();
        expect(screen.getByRole('link', { name: /GitHub/i })).toBeTruthy();
    });

    it('explique l’absence de jobs suivis', () => {
        render(
            <RunnerGithubJobsPanel
                jobs={{
                    ...payload,
                    counts: { in_progress: 0, queued: 0, failure: 0 },
                    items: [],
                }}
                loading={false}
                error={null}
                refreshing={false}
                onRetry={vi.fn()}
            />,
        );

        expect(screen.getByText(/Aucun job en cours/)).toBeTruthy();
    });
});
