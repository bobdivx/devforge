import { ChevronDown, Loader2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { formatActiveDeploymentsLabel } from '../lib/active-deployments-label';
import { applicationPath } from '../lib/application-tabs';
import { domainApi, type Deployment } from '../lib/domain-api';
import { parseDeploymentStatus } from '../lib/deployment-status';
import { routeHref } from '../lib/routes';
import { useTeamContext } from '../lib/team-context';
import { DeploymentStatusIcon } from './ui/DeploymentStatusIcon';

const POLL_MS = 3000;

function deploymentHref(deployment: Deployment): string {
    if (deployment.application?.uuid) {
        return routeHref(applicationPath(deployment.application.uuid, 'deployments'));
    }

    return routeHref('/deployments');
}

function DeploymentList({
    deployments,
    onNavigate,
}: {
    deployments: Deployment[];
    onNavigate?: () => void;
}) {
    return (
        <ul class="max-h-72 space-y-2 overflow-y-auto p-3">
            {deployments.map((deployment) => {
                const parsed = parseDeploymentStatus(deployment.status);

                return (
                    <li key={deployment.uuid}>
                        <a
                            class="flex items-start gap-3 rounded-xl border border-base-300/70 bg-base-200/40 px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-primary/5"
                            href={deploymentHref(deployment)}
                            onClick={onNavigate}
                        >
                            <DeploymentStatusIcon status={deployment.status} />
                            <div class="min-w-0 flex-1">
                                <p class="truncate text-sm font-semibold text-base-content">
                                    {deployment.application?.name ?? 'Application'}
                                </p>
                                <p class="mt-0.5 text-xs text-base-content/55">{parsed.shortLabel}</p>
                                {deployment.commit_message && (
                                    <p class="mt-1 truncate text-[11px] text-base-content/45">
                                        {deployment.commit_message}
                                    </p>
                                )}
                            </div>
                        </a>
                    </li>
                );
            })}
        </ul>
    );
}

function TriggerButton({
    count,
    expanded,
    onToggle,
    className = '',
}: {
    count: number;
    expanded: boolean;
    onToggle: () => void;
    className?: string;
}) {
    return (
        <button
            type="button"
            class={`inline-flex items-center gap-2 rounded-full border border-warning/30 bg-warning/10 px-3 py-1.5 text-sm font-medium text-warning transition-colors hover:bg-warning/15 ${className}`}
            aria-expanded={expanded}
            onClick={onToggle}
        >
            <Loader2 class="size-3.5 animate-spin" aria-hidden />
            <span>{formatActiveDeploymentsLabel(count)}</span>
            <ChevronDown
                class={`size-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                aria-hidden
            />
        </button>
    );
}

export function DeploymentsIndicator() {
    const { revision } = useTeamContext();
    const [deployments, setDeployments] = useState<Deployment[]>([]);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const load = async (silent = false) => {
            try {
                const response = await domainApi.deployments(1, undefined, 50, { active: true });
                if (cancelled) {
                    return;
                }
                setDeployments(response.data ?? []);
            } catch {
                if (!silent && !cancelled) {
                    setDeployments([]);
                }
            }
        };

        void load();
        const timer = window.setInterval(() => {
            void load(true);
        }, POLL_MS);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [revision]);

    useEffect(() => {
        if (deployments.length === 0) {
            setExpanded(false);
        }
    }, [deployments.length]);

    if (deployments.length === 0) {
        return null;
    }

    const count = deployments.length;

    return (
        <>
            {/* Desktop — chip dans le header */}
            <div class="relative hidden md:block">
                <TriggerButton
                    count={count}
                    expanded={expanded}
                    onToggle={() => setExpanded((current) => !current)}
                />
                {expanded && (
                    <div
                        class="absolute end-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-xl"
                        role="region"
                        aria-label="Déploiements en cours"
                    >
                        <div class="flex items-center justify-between border-b border-base-300/80 px-3 py-2.5">
                            <p class="text-xs font-semibold uppercase tracking-wide text-base-content/45">
                                En cours
                            </p>
                            <a class="link link-hover text-xs" href={routeHref('/deployments')}>
                                Cartographie
                            </a>
                        </div>
                        <DeploymentList
                            deployments={deployments}
                            onNavigate={() => setExpanded(false)}
                        />
                    </div>
                )}
            </div>

            {/* Mobile — panneau déroulant en bas d’écran */}
            <div class="fixed inset-x-0 bottom-0 z-50 md:hidden">
                <div class="mx-auto max-w-lg px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <div class="overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-2xl">
                        <div class="flex justify-center px-3 pt-2">
                            <TriggerButton
                                count={count}
                                expanded={expanded}
                                onToggle={() => setExpanded((current) => !current)}
                                className="w-full justify-center rounded-xl py-2.5"
                            />
                        </div>
                        {expanded && (
                            <div
                                class="border-t border-base-300/80"
                                role="region"
                                aria-label="Déploiements en cours"
                            >
                                <div class="flex items-center justify-between px-3 py-2">
                                    <p class="text-xs font-semibold uppercase tracking-wide text-base-content/45">
                                        En cours
                                    </p>
                                    <a class="link link-hover text-xs" href={routeHref('/deployments')}>
                                        Cartographie
                                    </a>
                                </div>
                                <DeploymentList
                                    deployments={deployments}
                                    onNavigate={() => setExpanded(false)}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
