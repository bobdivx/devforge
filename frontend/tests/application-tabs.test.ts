import { describe, expect, it } from 'vitest';
import {
    applicationPath,
    applicationTabFromLegacySegment,
    applicationTabGroups,
    applicationTabs,
    parseApplicationTab,
} from '../src/lib/application-tabs';
import {
    databasePath,
    extractApplicationUuid,
    findRoute,
    parseDatabaseTab,
    parseServiceTab,
    resolveResourceCanonicalLocation,
    servicePath,
} from '../src/lib/routes';

describe('onglets applications / databases', () => {
    it('groupe les onglets application par domaine', () => {
        expect(applicationTabGroups.map(({ id, label }) => ({ id, label }))).toEqual([
            { id: 'health', label: 'Santé' },
            { id: 'connect', label: 'Connexions' },
            { id: 'configure', label: 'Configuration' },
            { id: 'danger', label: 'Zone sensible' },
        ]);
        expect(applicationTabs.map(({ id }) => id)).toEqual([
            'overview',
            'deployments',
            'logs',
            'previews',
            'domains',
            'databases',
            'variables',
            'files',
            'settings',
            'tasks',
            'webhooks',
            'storage',
            'limits',
            'danger',
        ]);
    });
    it('parse les onglets applications connus', () => {
        expect(parseApplicationTab('logs')).toBe('logs');
        expect(parseApplicationTab('webhooks')).toBe('webhooks');
        expect(parseApplicationTab('tasks')).toBe('tasks');
        expect(parseApplicationTab('previews')).toBe('previews');
        expect(parseApplicationTab('storage')).toBe('storage');
        expect(parseApplicationTab('limits')).toBe('limits');
        expect(parseApplicationTab('inconnu')).toBe('overview');
        expect(applicationPath('app-uuid', 'logs')).toBe('/applications/app-uuid?tab=logs');
        expect(applicationPath('app-uuid', 'tasks')).toBe('/applications/app-uuid?tab=tasks');
        expect(applicationPath('app-uuid', 'previews')).toBe('/applications/app-uuid?tab=previews');
        expect(applicationPath('app-uuid', 'storage')).toBe('/applications/app-uuid?tab=storage');
        expect(applicationPath('app-uuid', 'limits')).toBe('/applications/app-uuid?tab=limits');
        expect(applicationPath('app-uuid')).toBe('/applications/app-uuid');
    });

    it('mappe les segments Coolify vers les onglets DevForge', () => {
        expect(applicationTabFromLegacySegment('environment-variables')).toBe('variables');
        expect(applicationTabFromLegacySegment('source')).toBe('files');
        expect(applicationTabFromLegacySegment('webhooks')).toBe('webhooks');
        expect(applicationTabFromLegacySegment('scheduled-tasks')).toBe('tasks');
        expect(applicationTabFromLegacySegment('preview-deployments')).toBe('previews');
        expect(applicationTabFromLegacySegment('persistent-storage')).toBe('storage');
        expect(applicationTabFromLegacySegment('resource-limits')).toBe('limits');
        expect(applicationTabFromLegacySegment('deployment')).toBe('deployments');
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/application/app-uuid/scheduled-tasks'),
        ).toBe('/applications/app-uuid?tab=tasks');
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/application/app-uuid/preview-deployments'),
        ).toBe('/applications/app-uuid?tab=previews');
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/application/app-uuid/persistent-storage'),
        ).toBe('/applications/app-uuid?tab=storage');
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/application/app-uuid/resource-limits'),
        ).toBe('/applications/app-uuid?tab=limits');
        expect(parseDatabaseTab('logs')).toBe('logs');
        expect(parseDatabaseTab('backups')).toBe('backups');
        expect(parseDatabaseTab('variables')).toBe('variables');
        expect(parseDatabaseTab('webhooks')).toBe('webhooks');
        expect(parseDatabaseTab('storage')).toBe('storage');
        expect(parseDatabaseTab('healthcheck')).toBe('healthcheck');
        expect(databasePath('db-uuid', 'logs')).toBe('/databases?uuid=db-uuid&tab=logs');
        expect(databasePath('db-uuid', 'variables')).toBe('/databases?uuid=db-uuid&tab=variables');
        expect(databasePath('db-uuid', 'storage')).toBe('/databases?uuid=db-uuid&tab=storage');
        expect(databasePath('db-uuid', 'healthcheck')).toBe('/databases?uuid=db-uuid&tab=healthcheck');
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/database/db-uuid/environment-variables'),
        ).toBe('/databases?uuid=db-uuid&tab=variables');
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/database/db-uuid/webhooks'),
        ).toBe('/databases?uuid=db-uuid&tab=webhooks');
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/database/db-uuid/persistent-storage'),
        ).toBe('/databases?uuid=db-uuid&tab=storage');
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/database/db-uuid/healthcheck'),
        ).toBe('/databases?uuid=db-uuid&tab=healthcheck');
        expect(parseServiceTab('tasks')).toBe('tasks');
        expect(parseServiceTab('variables')).toBe('variables');
        expect(parseServiceTab('webhooks')).toBe('webhooks');
        expect(servicePath('svc-uuid', 'tasks')).toBe('/services?uuid=svc-uuid&tab=tasks');
        expect(servicePath('svc-uuid', 'variables')).toBe('/services?uuid=svc-uuid&tab=variables');
        expect(servicePath('svc-uuid', 'webhooks')).toBe('/services?uuid=svc-uuid&tab=webhooks');
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/service/svc-uuid/scheduled-tasks'),
        ).toBe('/services?uuid=svc-uuid&tab=tasks');
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/service/svc-uuid/environment-variables'),
        ).toBe('/services?uuid=svc-uuid&tab=variables');
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/service/svc-uuid/webhooks'),
        ).toBe('/services?uuid=svc-uuid&tab=webhooks');
    });

    it('extrait l’uuid application depuis les chemins natifs et Coolify', () => {
        expect(extractApplicationUuid('/applications/app-uuid')).toBe('app-uuid');
        expect(
            extractApplicationUuid('/project/p/environment/e/application/app-uuid/logs'),
        ).toBe('app-uuid');
    });

    it('réécrit les URLs Coolify vers les chemins DevForge', () => {
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/application/app-uuid/logs'),
        ).toBe('/applications/app-uuid?tab=logs');
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/database/db-uuid/backups'),
        ).toBe('/databases?uuid=db-uuid&tab=backups');
        expect(
            resolveResourceCanonicalLocation('/project/p/environment/e/database/db-uuid/logs'),
        ).toBe('/databases?uuid=db-uuid&tab=logs');
        expect(resolveResourceCanonicalLocation('/applications/app-uuid')).toBeNull();
    });

    it('route les détails Coolify application vers application-detail', () => {
        expect(
            findRoute('/devforge/project/project-uuid/environment/environment-uuid/application/app-uuid/logs').page,
        ).toBe('application-detail');
        expect(
            findRoute('/devforge/project/project-uuid/environment/environment-uuid/application/app-uuid/logs').path,
        ).toBe('/applications/app-uuid');
        expect(
            findRoute('/devforge/project/project-uuid/environment/environment-uuid/database/db-uuid/backups').path,
        ).toBe('/databases');
    });
});
