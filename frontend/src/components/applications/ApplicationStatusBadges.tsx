import {
    CheckCircle2,
    CircleAlert,
    CircleHelp,
    Database,
    Globe,
    Loader2,
    Rocket,
    XCircle,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
    type ApplicationReadiness,
    type Deployment,
    type LinkableDatabase,
    domainApi,
} from '../../lib/domain-api';
import { parseDeploymentStatus } from '../../lib/deployment-status';
import { parseResourceStatus, type ResourceStatusTone } from '../../lib/resource-status';
import { useApiQuery } from '../../lib/use-api-query';

type Tone = ResourceStatusTone;

type BadgeItem = {
    id: string;
    label: string;
    detail: string;
    tone: Tone;
    Icon: typeof CheckCircle2;
    spin?: boolean;
};

type Props = {
    applicationUuid: string;
    resourceStatus: string | { reachable: boolean; usable: boolean; validating: boolean };
    latestDeployment: Deployment | null;
    readiness: ApplicationReadiness | null;
    readinessLoading?: boolean;
    /** Rafraîchir le badge base pendant un déploiement actif. */
    pollDatabases?: boolean;
    onOpenTab?: (tab: 'deployments' | 'databases' | 'domains') => void;
};

const toneClasses: Record<Tone, string> = {
    success: 'border-success/30 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    error: 'border-error/30 bg-error/10 text-error',
    neutral: 'border-base-300/80 bg-base-200/70 text-base-content/55',
};

function urlBadge(readiness: ApplicationReadiness | null, loading: boolean): BadgeItem {
    if (loading && !readiness) {
        return {
            id: 'url',
            label: 'URL',
            detail: '…',
            tone: 'neutral',
            Icon: Loader2,
            spin: true,
        };
    }

    if (!readiness) {
        return {
            id: 'url',
            label: 'URL',
            detail: 'Inconnu',
            tone: 'neutral',
            Icon: CircleHelp,
        };
    }

    if (readiness.status === 'healthy' || readiness.last_probe_ok === true) {
        return {
            id: 'url',
            label: 'URL',
            detail: 'Accessible',
            tone: 'success',
            Icon: Globe,
        };
    }

    if (readiness.status === 'probing' || readiness.status === 'recovering') {
        return {
            id: 'url',
            label: 'URL',
            detail: readiness.status === 'probing' ? 'Vérification…' : 'Récupération…',
            tone: 'warning',
            Icon: Loader2,
            spin: true,
        };
    }

    if (readiness.status === 'awaiting_user') {
        return {
            id: 'url',
            label: 'URL',
            detail: 'Action requise',
            tone: 'warning',
            Icon: CircleAlert,
        };
    }

    if (readiness.status === 'failed' || readiness.last_probe_ok === false) {
        return {
            id: 'url',
            label: 'URL',
            detail: readiness.last_http_status
                ? `HTTP ${readiness.last_http_status}`
                : 'Inaccessible',
            tone: 'error',
            Icon: XCircle,
        };
    }

    return {
        id: 'url',
        label: 'URL',
        detail: readiness.probe_url ? 'Non vérifiée' : 'Aucun domaine',
        tone: 'neutral',
        Icon: Globe,
    };
}

function databaseBadge(
    connections: Array<{ database_uuid: string }>,
    databases: LinkableDatabase[],
    loading: boolean,
): BadgeItem {
    if (loading) {
        return {
            id: 'db',
            label: 'Base',
            detail: '…',
            tone: 'neutral',
            Icon: Loader2,
            spin: true,
        };
    }

    if (connections.length === 0) {
        return {
            id: 'db',
            label: 'Base',
            detail: 'Non rattachée',
            tone: 'neutral',
            Icon: Database,
        };
    }

    const linked = connections
        .map((connection) => databases.find((database) => database.uuid === connection.database_uuid))
        .filter((database): database is LinkableDatabase => Boolean(database));

    if (linked.length === 0) {
        return {
            id: 'db',
            label: 'Base',
            detail: `${connections.length} liée${connections.length > 1 ? 's' : ''}`,
            tone: 'success',
            Icon: Database,
        };
    }

    const unhealthy = linked.filter((database) => {
        const tone = parseResourceStatus(database.status).tone;
        return tone === 'error' || tone === 'warning';
    });

    if (unhealthy.length > 0) {
        return {
            id: 'db',
            label: 'Base',
            detail: unhealthy.length === linked.length ? 'Indisponible' : 'Dégradée',
            tone: unhealthy.every((database) => parseResourceStatus(database.status).tone === 'error')
                ? 'error'
                : 'warning',
            Icon: CircleAlert,
        };
    }

    return {
        id: 'db',
        label: 'Base',
        detail: linked.length === 1 ? 'Accessible' : `${linked.length} accessibles`,
        tone: 'success',
        Icon: CheckCircle2,
    };
}

function deploymentBadge(latest: Deployment | null): BadgeItem {
    if (!latest) {
        return {
            id: 'deploy',
            label: 'Déploiement',
            detail: 'Aucun',
            tone: 'neutral',
            Icon: Rocket,
        };
    }

    const parsed = parseDeploymentStatus(latest.status);

    return {
        id: 'deploy',
        label: 'Déploiement',
        detail: parsed.shortLabel,
        tone: parsed.tone,
        Icon: parsed.Icon,
        spin: parsed.spin,
    };
}

function StatusChip({
    item,
    onClick,
}: {
    item: BadgeItem;
    onClick?: () => void;
}) {
    const Icon = item.Icon;
    const content: ComponentChildren = (
        <>
            <Icon class={`size-3.5 shrink-0 ${item.spin ? 'animate-spin' : ''}`} aria-hidden />
            <span class="text-[10px] font-medium uppercase tracking-wide opacity-70">{item.label}</span>
            <span class="text-[11px] font-semibold">{item.detail}</span>
        </>
    );

    const className = `inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 ${toneClasses[item.tone]}`;

    if (onClick) {
        return (
            <button
                type="button"
                class={`${className} transition hover:opacity-90`}
                title={`${item.label} : ${item.detail}`}
                onClick={onClick}
            >
                {content}
            </button>
        );
    }

    return (
        <span class={className} title={`${item.label} : ${item.detail}`}>
            {content}
        </span>
    );
}

export function ApplicationStatusBadges({
    applicationUuid,
    resourceStatus,
    latestDeployment,
    readiness,
    readinessLoading = false,
    pollDatabases = false,
    onOpenTab,
}: Props) {
    const databasesQuery = useApiQuery(
        `linkable-databases:${applicationUuid}`,
        () => domainApi.linkableDatabases(applicationUuid),
    );

    useEffect(() => {
        if (!pollDatabases) {
            return;
        }

        const interval = window.setInterval(() => {
            void databasesQuery.reload({ silent: true });
        }, 3000);

        return () => window.clearInterval(interval);
    }, [pollDatabases, applicationUuid, databasesQuery.reload]);

    const wasPollingDatabasesRef = useRef(false);
    useEffect(() => {
        if (wasPollingDatabasesRef.current && !pollDatabases) {
            void databasesQuery.reload({ silent: true });
        }
        wasPollingDatabasesRef.current = pollDatabases;
    }, [pollDatabases, databasesQuery.reload]);

    const databases = databasesQuery.data?.data ?? [];
    const connections = databasesQuery.data?.meta?.connections ?? [];

    const appParsed = parseResourceStatus(resourceStatus);
    const AppIcon = appParsed.Icon;

    const items: BadgeItem[] = [
        {
            id: 'app',
            label: 'App',
            detail: appParsed.shortLabel,
            tone: appParsed.tone,
            Icon: AppIcon,
            spin: appParsed.spin,
        },
        deploymentBadge(latestDeployment),
        urlBadge(readiness, readinessLoading),
        databaseBadge(connections, databases, databasesQuery.loading),
    ];

    return (
        <div class="flex flex-wrap gap-2" role="list" aria-label="État de l’application">
            {items.map((item) => (
                <div key={item.id} role="listitem">
                    <StatusChip
                        item={item}
                        onClick={
                            item.id === 'deploy' && onOpenTab
                                ? () => onOpenTab('deployments')
                                : item.id === 'db' && onOpenTab
                                    ? () => onOpenTab('databases')
                                    : item.id === 'url' && onOpenTab
                                        ? () => onOpenTab('domains')
                                        : undefined
                        }
                    />
                </div>
            ))}
        </div>
    );
}
