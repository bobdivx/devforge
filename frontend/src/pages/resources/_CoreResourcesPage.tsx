import { Play, Plus, RefreshCw, RotateCw, Rocket, Square } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApplicationBootSequenceBanner } from '../../components/applications/ApplicationBootSequenceBanner';
import { ApplicationDetailPanel } from '../../components/applications/ApplicationDetailPanel';
import { ApplicationLogo } from '../../components/applications/ApplicationLogo';
import { CreateApplicationModal } from '../../components/applications/CreateApplicationModal';
import { CreateDatabaseModal } from '../../components/databases/CreateDatabaseModal';
import { DatabaseDetailPanel } from '../../components/databases/DatabaseDetailPanel';
import { ServiceDetailPanel } from '../../components/services/ServiceDetailPanel';
import { PageHeader } from '../../components/PageHeader';
import { ActionToolbar } from '../../components/ui/ActionToolbar';
import { Breadcrumbs } from '../../components/ui/Breadcrumbs';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataState } from '../../components/ui/DataState';
import { FilterBar } from '../../components/ui/FilterBar';
import { ResourceCard } from '../../components/ui/ResourceCard';
import { ResourceStatusIcon } from '../../components/ui/ResourceStatusIcon';
import { StatCard } from '../../components/ui/StatCard';
import { resourceStatusInput } from '../../lib/resource-status';
import { resolveCoreResourceActions } from '../../lib/core-resource-actions';
import type { BootstrapPermissions } from '../../lib/bootstrap';
import {
    domainApi,
    type ApplicationBootSequenceItem,
    type CoreAction,
    type CoreResource,
    type CoreResourceType,
} from '../../lib/domain-api';
import { applicationPath, parseApplicationTab, type ApplicationTabId } from '../../lib/application-tabs';
import {
    databasePath,
    parseDatabaseTab,
    parseServiceTab,
    servicePath,
    type DatabaseDetailTabId,
    type ServiceDetailTabId,
} from '../../lib/routes';
import { parseResourceStatus } from '../../lib/resource-status';
import { useApplicationBootSequence } from '../../lib/hooks/use-application-boot-sequence';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo, useNavigate } from '../../lib/use-navigate';
import { sanitizeResourceUuid } from '../../lib/route-path';

function bootPhaseForResource(
    resourceUuid: string,
    items: ApplicationBootSequenceItem[],
    bootActive: boolean,
): ApplicationBootSequenceItem['phase'] | null {
    if (!bootActive) {
        return null;
    }

    return items.find((item) => item.uuid === resourceUuid)?.phase ?? null;
}

function bootCardClass(phase: ApplicationBootSequenceItem['phase'] | null): string {
    if (phase === null) {
        return '';
    }

    if (phase === 'waiting') {
        return 'application-boot-card application-boot-card--waiting';
    }

    if (phase === 'starting') {
        return 'application-boot-card application-boot-card--starting';
    }

    if (phase === 'running') {
        return 'application-boot-card application-boot-card--running';
    }

    if (phase === 'failed') {
        return 'application-boot-card application-boot-card--failed';
    }

    return 'application-boot-card';
}

function readUuidDeepLink(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }

    return sanitizeResourceUuid(new URLSearchParams(window.location.search).get('uuid'));
}

function readDatabaseDeepLink(): { uuid: string | null; tab: DatabaseDetailTabId } {
    if (typeof window === 'undefined') {
        return { uuid: null, tab: 'overview' };
    }

    const params = new URLSearchParams(window.location.search);

    return {
        uuid: sanitizeResourceUuid(params.get('uuid')),
        tab: parseDatabaseTab(params.get('tab')),
    };
}

function readServiceDeepLink(): { uuid: string | null; tab: ServiceDetailTabId } {
    if (typeof window === 'undefined') {
        return { uuid: null, tab: 'overview' };
    }

    const params = new URLSearchParams(window.location.search);

    return {
        uuid: sanitizeResourceUuid(params.get('uuid')),
        tab: parseServiceTab(params.get('tab')),
    };
}

function readApplicationTabDeepLink(): ApplicationTabId {
    if (typeof window === 'undefined') {
        return 'agents';
    }

    return parseApplicationTab(new URLSearchParams(window.location.search).get('tab'));
}

type CoreResourcesPageProps = {
    type: CoreResourceType;
    permissions: BootstrapPermissions;
    embedded?: boolean;
    legacyBaseUrl?: string;
    initialResourceUuid?: string | null;
};

const labels: Record<CoreResourceType, string> = {
    servers: 'Serveurs',
    applications: 'Applications',
    databases: 'Bases de données',
    services: 'Services',
};

const descriptions: Record<CoreResourceType, string> = {
    servers: 'Hôtes SSH, proxy et destinations de déploiement.',
    applications: 'Santé, déploiements et accès rapide à vos apps.',
    databases: 'Instances, connexions et sauvegardes.',
    services: 'Stacks et services gérés.',
};

const actionLabels: Record<CoreAction, string> = {
    start: 'Démarrer',
    stop: 'Arrêter',
    restart: 'Redémarrer',
    deploy: 'Déployer',
};

const actionIcons = {
    start: Play,
    stop: Square,
    restart: RotateCw,
    deploy: Rocket,
};

function databaseCardTitle(resource: CoreResource): string {
    const applications = resource.connected_applications ?? [];

    if (/^libsql-database-[a-z0-9]+$/i.test(resource.name) && applications.length > 0) {
        return applications.length === 1
            ? `Base de ${applications[0].application_name}`
            : applications.map((application) => application.application_name).join(', ');
    }

    if (applications.length === 0) {
        return 'Sans application';
    }

    return applications.map((application) => application.application_name).join(', ');
}

function databaseCardSubtitle(resource: CoreResource): string {
    const engineLabel = resource.engine_label ?? resource.engine ?? 'Base de données';
    const status = parseResourceStatus(resource.status).shortLabel;

    return `${engineLabel} · ${status}`;
}

function resourceSearchHaystack(resource: CoreResource, resourceType: CoreResourceType): string {
    const values = [resource.name, resource.uuid];

    if (resourceType === 'databases') {
        values.push(resource.engine ?? '', resource.engine_label ?? '');
        values.push(...(resource.connected_applications ?? []).map((application) => application.application_name));
    }

    return values.join(' ').toLowerCase();
}
