import { describe, expect, it } from 'vitest';
import type { DeploymentTopology } from '../src/lib/domain-api';
import {
    buildApplicationPipelines,
    filterPipelines,
} from '../src/lib/deployment-topology-layout';

function sampleTopology(): DeploymentTopology {
    return {
        nodes: [
            { id: 'hub:devforge', type: 'hub', label: 'DevForge', subtitle: 'Orchestrateur', tone: 'primary', status: null, href: '/', meta: {} },
            { id: 'github:1', type: 'github', label: 'GitHub', subtitle: 'Connexion', tone: 'info', status: null, href: '/connexions', meta: {} },
            { id: 'repo:app1', type: 'repository', label: 'acme/app', subtitle: 'Branche · main', tone: 'info', status: null, href: null, meta: { git_branch: 'main' } },
            { id: 'app:app1', type: 'application', label: 'App One', subtitle: 'Application', tone: 'success', status: 'running', href: '/applications/app1', meta: { environment: 'production' } },
            { id: 'deployment:d1', type: 'deployment', label: 'abcdef1', subtitle: 'Terminé', tone: 'success', status: 'finished', href: null, meta: { commit: 'abcdef123' } },
            { id: 'production:app1', type: 'production', label: 'app.example.com', subtitle: 'URL en production', tone: 'success', status: 'reachable', href: 'https://app.example.com', meta: { external: true, url: 'https://app.example.com' } },
            { id: 'agent:a1', type: 'agent', label: 'Deploy Bot', subtitle: 'Agent', tone: 'warning', status: 'running', href: '/agents/a1', meta: {} },
            { id: 'intervention:i1', type: 'intervention', label: 'Fix build', subtitle: 'Terminée', tone: 'success', status: 'completed', href: '/agents/a1', meta: {} },
            { id: 'app:app2', type: 'application', label: 'App Two', subtitle: 'Application', tone: 'warning', status: 'degraded', href: '/applications/app2', meta: {} },
            { id: 'deployment:d2', type: 'deployment', label: 'deadbeef', subtitle: 'Échoué', tone: 'error', status: 'failed', href: null, meta: {} },
        ],
        edges: [
            { id: '1', from: 'hub:devforge', to: 'github:1', kind: 'connecte', label: 'Connexion' },
            { id: '2', from: 'hub:devforge', to: 'app:app1', kind: 'gere', label: 'Gère' },
            { id: '3', from: 'hub:devforge', to: 'agent:a1', kind: 'pilote', label: 'Pilote' },
            { id: '4', from: 'github:1', to: 'repo:app1', kind: 'heberge', label: 'Héberge' },
            { id: '5', from: 'repo:app1', to: 'app:app1', kind: 'source', label: 'Source' },
            { id: '6', from: 'app:app1', to: 'deployment:d1', kind: 'deploie', label: 'Déploie' },
            { id: '7', from: 'app:app1', to: 'production:app1', kind: 'publie', label: 'Publie' },
            { id: '8', from: 'agent:a1', to: 'intervention:i1', kind: 'intervient', label: 'Intervient' },
            { id: '9', from: 'intervention:i1', to: 'deployment:d1', kind: 'surveille', label: 'Surveille' },
            { id: '10', from: 'hub:devforge', to: 'app:app2', kind: 'gere', label: 'Gère' },
            { id: '11', from: 'app:app2', to: 'deployment:d2', kind: 'deploie', label: 'Déploie' },
            { id: '12', from: 'agent:a1', to: 'app:app1', kind: 'assigne', label: 'Assigné à' },
        ],
        summary: {
            applications: 2,
            deployments: 2,
            production_urls: 1,
            agents: 1,
            interventions: 1,
            github_connections: 1,
            repositories: 1,
            reachable_urls: 1,
            agents_enabled: true,
        },
    };
}

describe('buildApplicationPipelines', () => {
    it('construit un parcours lisible par application', () => {
        const overview = buildApplicationPipelines(sampleTopology());

        expect(overview.pipelines).toHaveLength(2);

        const appOne = overview.pipelines.find((pipeline) => pipeline.application.label === 'App One');
        expect(appOne).toBeTruthy();
        expect(appOne!.stages.map((stage) => stage.kind)).toEqual([
            'source',
            'application',
            'deployment',
            'production',
        ]);
        expect(appOne!.stages[0].label).toBe('acme/app');
        expect(appOne!.stages[3].label).toBe('app.example.com');
        expect(appOne!.health).toBe('healthy');
        expect(appOne!.agents[0]?.interventions[0]?.label).toBe('Fix build');
    });

    it('filtre par santé et recherche', () => {
        const { pipelines } = buildApplicationPipelines(sampleTopology());

        expect(filterPipelines(pipelines, '', 'failing')).toHaveLength(1);
        expect(filterPipelines(pipelines, 'example.com', 'all')[0]?.application.label).toBe('App One');
        expect(filterPipelines(pipelines, 'inexistant', 'all')).toHaveLength(0);
    });
});
