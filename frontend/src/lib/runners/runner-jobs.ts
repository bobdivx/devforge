import type { GithubRunnerJob, GithubRunnerJobBucket, GithubRunnerJobs } from '../domain-api';

export const RUNNER_JOB_BUCKETS: GithubRunnerJobBucket[] = ['in_progress', 'queued', 'failure'];

export function runnerJobBucketLabel(bucket: GithubRunnerJobBucket): string {
    return ({
        in_progress: 'En cours',
        queued: 'En attente',
        failure: 'En échec',
    })[bucket];
}

export function runnerJobTone(bucket: GithubRunnerJobBucket): 'success' | 'warning' | 'neutral' | 'error' {
    if (bucket === 'in_progress') {
        return 'success';
    }
    if (bucket === 'queued') {
        return 'warning';
    }
    return 'error';
}

export function emptyRunnerJobCounts(): Record<GithubRunnerJobBucket, number> {
    return { in_progress: 0, queued: 0, failure: 0 };
}

export function runnerJobCounts(jobs: GithubRunnerJobs | null | undefined): Record<GithubRunnerJobBucket, number> {
    return jobs?.counts ?? emptyRunnerJobCounts();
}

export function runnerHasTrackedJobs(jobs: GithubRunnerJobs | null | undefined): boolean {
    const counts = runnerJobCounts(jobs);
    return counts.in_progress + counts.queued + counts.failure > 0;
}

export function formatRunnerJobWhen(value: string | null | undefined, now = Date.now()): string | null {
    if (!value) {
        return null;
    }

    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
        return value;
    }

    const deltaSeconds = Math.max(0, Math.round((now - timestamp) / 1000));
    if (deltaSeconds < 60) {
        return 'à l’instant';
    }
    if (deltaSeconds < 3600) {
        return `il y a ${Math.floor(deltaSeconds / 60)} min`;
    }
    if (deltaSeconds < 86400) {
        return `il y a ${Math.floor(deltaSeconds / 3600)} h`;
    }

    return `il y a ${Math.floor(deltaSeconds / 86400)} j`;
}

export function runnerJobSummary(job: GithubRunnerJob): string {
    const parts = [job.workflow_name, job.name].filter((part) => part.trim() !== '');
    return parts.join(' · ');
}
