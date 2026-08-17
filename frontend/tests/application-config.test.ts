import { describe, expect, it } from 'vitest';
import {
    applicationStatusLabel,
    applicationStatusTone,
    deploymentSystemLabel,
    ensureDomainScheme,
    formatDateTime,
    parseApplicationConfiguration,
    primaryDomain,
    repositoryLabel,
    resolvePreviewAvailability,
    shortCommit,
    visitUrl,
    websiteScreenshotUrl,
} from '../src/lib/application-config';
import type { ApplicationReadiness, CoreResource } from '../src/lib/domain-api';

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
            is_static: false,
            start_command: 'npm run start',
            ports_exposes: '3000',
            health_check_enabled: true,
            health_check_path: '/',
            health_check_port: '3000',
            detected_framework: 'astro-static',
            publish_directory: '/dist',
            base_directory: '/',
        });

        expect(config.build_pack).toBe('nixpacks');
        expect(config.git_branch).toBe('main');
        expect(config.domains).toHaveLength(2);
        expect(config.project?.name).toBe('Popcorn');
        expect(config.is_static).toBe(false);
        expect(config.start_command).toBe('npm run start');
        expect(config.ports_exposes).toBe('3000');
        expect(config.health_check_enabled).toBe(true);
        expect(config.detected_framework).toBe('astro-static');
        expect(config.publish_directory).toBe('/dist');
        expect(primaryDomain(config.domains)).toBe('https://app.example.test');
        expect(visitUrl(primaryDomain(config.domains))).toBe('https://app.example.test');
        expect(repositoryLabel(config.git_repository)).toBe('github.com/example/app');
        expect(websiteScreenshotUrl(primaryDomain(config.domains))).toBe(
            'https://s.wordpress.com/mshots/v1/https%3A%2F%2Fapp.example.test?w=960',
        );
    });

    it('affiche un libellé de système de déploiement', () => {
        expect(deploymentSystemLabel({
            detected_framework: 'astro-static',
            build_pack: 'nixpacks',
            is_static: true,
        })).toBe('Astro static');

        expect(deploymentSystemLabel({
            detected_framework: null,
            build_pack: 'nixpacks',
            is_static: true,
        })).toBe('nixpacks · statique');

        expect(deploymentSystemLabel({
            detected_framework: null,
            build_pack: 'dockerfile',
            is_static: false,
        })).toBe('dockerfile');
    });

    it('préfixe https sur un domaine sans schéma', () => {
        expect(ensureDomainScheme('sonozz.briseteia.me')).toBe('https://sonozz.briseteia.me');
        expect(ensureDomainScheme('https://app.example.com')).toBe('https://app.example.com');
        expect(ensureDomainScheme('http://app.local')).toBe('http://app.local');
        expect(ensureDomainScheme('  ')).toBe('');
        expect(visitUrl('sonozz.briseteia.me')).toBe('https://sonozz.briseteia.me');
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

    it('résout l’état d’aperçu selon readiness et conteneur', () => {
        const failed: ApplicationReadiness = {
            uuid: 'r1',
            status: 'failed',
            autonomous_enabled: true,
            last_probe_at: null,
            last_probe_ok: false,
            last_probe_error: 'timeout',
            last_http_status: 502,
            round: 1,
            max_rounds: 5,
            last_deployment_uuid: null,
            probe_url: 'https://app.example.test',
            intervention: null,
        };

        expect(resolvePreviewAvailability('stopped', null).label).toBe('Arrêté');
        expect(resolvePreviewAvailability('running:healthy', failed).label).toBe('URL inaccessible');
        expect(resolvePreviewAvailability('running:healthy', {
            ...failed,
            status: 'probing',
            last_probe_ok: null,
        }).label).toBe('Vérification…');
        expect(resolvePreviewAvailability('running:healthy', {
            ...failed,
            status: 'healthy',
            last_probe_ok: true,
            last_probe_error: null,
            last_http_status: 200,
        }).ready).toBe(true);
    });
});
