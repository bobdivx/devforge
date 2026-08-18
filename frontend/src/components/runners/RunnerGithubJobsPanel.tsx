import { Activity, ExternalLink, RefreshCw } from 'lucide-preact';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import type { GithubRunnerJobs } from '../../lib/domain-api';
import {
    formatRunnerJobWhen,
    RUNNER_JOB_BUCKETS,
    runnerHasTrackedJobs,
    runnerJobBucketLabel,
    runnerJobCounts,
    runnerJobSummary,
    runnerJobTone,
} from '../../lib/runners/runner-jobs';

type Props = {
    jobs: GithubRunnerJobs | null;
    loading: boolean;
    error: unknown;
    refreshing: boolean;
    onRetry: () => void;
};

export function RunnerGithubJobsPanel({
    jobs,
    loading,
    error,
    refreshing,
    onRetry,
}: Props) {
    const counts = runnerJobCounts(jobs);

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-5 py-4">
                <div class="flex items-center gap-2">
                    <Activity class="size-4 text-base-content/45" aria-hidden />
                    <div>
                        <p class="text-sm font-semibold">Actions GitHub</p>
                        <p class="text-xs text-base-content/50">
                            {jobs?.repo
                                ? `${jobs.repo} · jobs de ce runner · refresh auto 20s`
                                : 'Jobs en cours, en attente ou en échec sur ce runner'}
                        </p>
                    </div>
                </div>
                <button
                    class="btn btn-ghost btn-sm"
                    type="button"
                    disabled={refreshing}
                    onClick={onRetry}
                >
                    {refreshing
                        ? <span class="loading loading-spinner loading-xs" aria-hidden />
                        : <RefreshCw class="size-3.5" aria-hidden />}
                    Actualiser
                </button>
            </div>
            <div class="grid gap-3 p-5">
                <div class="flex flex-wrap gap-2">
                    {RUNNER_JOB_BUCKETS.map((bucket) => (
                        <StatusBadge
                            key={bucket}
                            label={`${runnerJobBucketLabel(bucket)} (${counts[bucket]})`}
                            tone={counts[bucket] > 0 ? runnerJobTone(bucket) : 'neutral'}
                        />
                    ))}
                </div>

                <DataState
                    loading={loading && !jobs}
                    error={error && !jobs ? error : null}
                    onRetry={onRetry}
                >
                    {jobs && !jobs.available && (
                        <p class="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                            {jobs.message ?? 'Actions GitHub indisponibles.'}
                        </p>
                    )}

                    {jobs && jobs.available && !runnerHasTrackedJobs(jobs) && (
                        <p class="text-xs text-base-content/55">
                            Aucun job en cours, en attente ou en échec pour ce runner.
                        </p>
                    )}

                    {jobs && runnerHasTrackedJobs(jobs) && (
                        <ul class="divide-y divide-base-300/80 rounded-xl border border-base-300/70">
                            {jobs.items.map((job) => (
                                <li key={job.id} class="flex items-start justify-between gap-3 px-3 py-2.5">
                                    <div class="min-w-0">
                                        <p class="truncate text-sm font-medium">{runnerJobSummary(job)}</p>
                                        <p class="mt-0.5 truncate text-[11px] text-base-content/50">
                                            {[
                                                job.head_branch,
                                                formatRunnerJobWhen(job.updated_at ?? job.started_at),
                                                job.assigned ? job.runner_name : 'pas encore assigné',
                                            ].filter(Boolean).join(' · ')}
                                        </p>
                                    </div>
                                    <div class="flex shrink-0 items-center gap-2">
                                        <StatusBadge
                                            label={runnerJobBucketLabel(job.bucket)}
                                            tone={runnerJobTone(job.bucket)}
                                        />
                                        {job.html_url && (
                                            <a
                                                class="btn btn-ghost btn-xs"
                                                href={job.html_url}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                <ExternalLink class="size-3" aria-hidden />
                                                GitHub
                                            </a>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </DataState>
            </div>
        </section>
    );
}
