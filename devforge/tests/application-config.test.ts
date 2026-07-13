import { describe, expect, it } from 'vitest';
import {
    applicationStatusLabel,
    applicationStatusTone,
    formatDateTime,
    parseApplicationConfiguration,
    primaryDomain,
    repositoryLabel,
    shortCommit,
    visitUrl,
    websiteScreenshotUrl,
} from '../src/lib/application-config';
import type { CoreResource } from '../src/lib/domain-api';

describe('configuration application', () => {
    it('parse la configuration exposée par l’API core', () => {
        const config = parseApplicationConfiguration({
            build_pack: 'nixpacks',
            git_repository: 'https://github.com/example/app',
            git_branch: 'main',
            domains: ['https://app.example.test', 'https://www.app.example.test'],
            project: { uuid: 'project-1', name: 'Popcorn' },
            environment: { uuid: 'env-1', name: 'production' },
            server: { uuid: 'server-1', name: 'Core server' },
        });

        expect(config.build_pack).toBe('nixpacks');
        expect(config.git_branch).toBe('main');
        expect(config.domains).toHaveLength(2);
        expect(config.project?.name).toBe('Popcorn');
        expect(primaryDomain(config.domains)).toBe('https://app.example.test');
        expect(visitUrl(primaryDomain(config.domains))).toBe('https://app.example.test');
        expect(repositoryLabel(config.git_repository)).toBe('github.com/example/app');
        expect(websiteScreenshotUrl(primaryDomain(config.domains))).toBe(
            'https://s.wordpress.com/mshots/v1/https%3A%2F%2Fapp.example.test?w=960',
        );
    });

    it('construit l’URL de capture d’écran à partir du domaine', () => {
        expect(websiteScreenshotUrl('mf3d.app')).toBe(
            'https://s.wordpress.com/mshots/v1/https%3A%2F%2Fmf3d.app?w=960',
        );
        expect(websiteScreenshotUrl(null)).toBeNull();
    });

    it('dérive le statut et le commit court', () => {
        const resource: CoreResource = {
            uuid: 'app-1',
            type: 'application',
            name: 'Popcorn Web',
            description: null,
            status: 'running',
            configuration: {},
            actions: ['deploy'],
            created_at: '2026-04-27T10:00:00.000Z',
            updated_at: '2026-04-27T12:00:00.000Z',
        };

        expect(applicationStatusLabel(resource)).toBe('running');
        expect(applicationStatusTone('running')).toBe('success');
        expect(shortCommit('84f8e3ef12ab')).toBe('84f8e3e');
        expect(formatDateTime(resource.updated_at)).toMatch(/2026/);
    });
});
