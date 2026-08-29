import { describe, expect, it } from 'vitest';
import { spotlightTabForSteps, spotlightTabForTool } from '../src/lib/application-spotlight';
import type { AgentChatStep } from '../src/lib/domain-api';

describe('spotlightTabForTool', () => {
    it('ouvre Déploiements pour deploy / start / stop / restart / nixpacks / docker', () => {
        expect(spotlightTabForTool('deploy_application')).toBe('deployments');
        expect(spotlightTabForTool('start_container')).toBe('deployments');
        expect(spotlightTabForTool('stop_service')).toBe('deployments');
        expect(spotlightTabForTool('restart_app')).toBe('deployments');
        expect(spotlightTabForTool('nixpacks_build')).toBe('deployments');
        expect(spotlightTabForTool('docker_ps')).toBe('deployments');
    });

    it('ouvre Logs pour logs / log', () => {
        expect(spotlightTabForTool('get_logs')).toBe('logs');
        expect(spotlightTabForTool('read_log')).toBe('logs');
        expect(spotlightTabForTool('application_logs')).toBe('logs');
        expect(spotlightTabForTool('deployment_logs')).toBe('logs');
    });

    it('ouvre Env pour env / variable / secret', () => {
        expect(spotlightTabForTool('set_env')).toBe('variables');
        expect(spotlightTabForTool('update_variable')).toBe('variables');
        expect(spotlightTabForTool('create_secret')).toBe('variables');
        expect(spotlightTabForTool('environment_variables')).toBe('variables');
    });

    it('ignore les outils sans cible workspace', () => {
        expect(spotlightTabForTool('list_github_apps')).toBeNull();
        expect(spotlightTabForTool('login')).toBeNull();
        expect(spotlightTabForTool('')).toBeNull();
    });
});

describe('spotlightTabForSteps', () => {
    it('préfère l’étape en cours, sinon la dernière étape mappable', () => {
        const steps: AgentChatStep[] = [
            { type: 'tool', name: 'list_github_apps', status: 'done' },
            { type: 'tool', name: 'deploy_application', status: 'done' },
            { type: 'tool', name: 'get_logs', status: 'running' },
        ];

        expect(spotlightTabForSteps(steps)).toBe('logs');
        expect(spotlightTabForSteps(steps.slice(0, 2))).toBe('deployments');
        expect(spotlightTabForSteps([])).toBeNull();
    });
});
