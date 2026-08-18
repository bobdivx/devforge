import { describe, expect, it } from 'vitest';
import type { GithubRunnerJob, GithubRunnerJobs } from '../src/lib/domain-api';
import {
    formatRunnerJobWhen,
    runnerHasTrackedJobs,
    runnerJobBucketLabel,
    runnerJobCounts,
    runnerJobSummary,
    runnerJobTone,
} from '../src/lib/runners/runner-jobs';

function jobs(partial: Partial<GithubRunnerJobs> = {}): GithubRunnerJobs {
    return {
        available: true,
        repo: 'bobdivx/popcorn-tauri',
        message: null,
        counts: { in_progress: 1, queued: 2, failure: 0 },
        items: [],
        ...partial,
    };
}

function job(partial: Partial<GithubRunnerJob> = {}): GithubRunnerJob {
    return {
        id: '101',
        name: 'build-windows',
        workflow_name: 'Desktop',
        bucket: 'in_progress',
        status: 'in_progress',
        ...partial,
    };
}

describe('runner-jobs', () => {
    it('étiquette et colore les buckets suivis', () => {
        expect(runnerJobBucketLabel('in_progress')).toBe('En cours');
        expect(runnerJobBucketLabel('queued')).toBe('En attente');
        expect(runnerJobBucketLabel('failure')).toBe('En échec');
        expect(runnerJobTone('in_progress')).toBe('success');
        expect(runnerJobTone('queued')).toBe('warning');
        expect(runnerJobTone('failure')).toBe('error');
    });

    it('détecte la présence de jobs à suivre', () => {
        expect(runnerHasTrackedJobs(jobs())).toBe(true);
        expect(runnerJobCounts(null)).toEqual({ in_progress: 0, queued: 0, failure: 0 });
        expect(runnerHasTrackedJobs(jobs({ counts: { in_progress: 0, queued: 0, failure: 0 } }))).toBe(false);
    });

    it('résume un job et formate l’horaire', () => {
        expect(runnerJobSummary(job())).toBe('Desktop · build-windows');
        expect(formatRunnerJobWhen('2026-08-18T06:50:00.000Z', Date.parse('2026-08-18T06:54:00.000Z'))).toBe('il y a 4 min');
        expect(formatRunnerJobWhen(null)).toBeNull();
    });
});
