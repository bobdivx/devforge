import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { ApplicationBootSequenceBanner } from '../src/components/applications/ApplicationBootSequenceBanner';
import type { ApplicationBootSequence } from '../src/lib/domain-api';

function sequence(overrides: Partial<ApplicationBootSequence> = {}): ApplicationBootSequence {
    return {
        active: true,
        status: 'running',
        started_at: '2026-08-17T08:00:00Z',
        finished_at: null,
        current_uuid: 'tesla',
        completed: 2,
        total: 3,
        poll_interval_ms: 2500,
        items: [
            {
                uuid: 'alpha',
                name: 'Alpha',
                order: 0,
                phase: 'running',
                status: 'running:healthy',
                message: null,
                started_at: null,
                finished_at: '2026-08-17T08:01:00Z',
            },
            {
                uuid: 'beta',
                name: 'Beta',
                order: 1,
                phase: 'running',
                status: 'running:healthy',
                message: null,
                started_at: null,
                finished_at: '2026-08-17T08:01:20Z',
            },
            {
                uuid: 'tesla',
                name: 'tesla',
                order: 2,
                phase: 'starting',
                status: 'starting',
                message: 'Déploiement en cours…',
                started_at: '2026-08-17T08:01:20Z',
                finished_at: null,
            },
        ],
        ...overrides,
    };
}

describe('ApplicationBootSequenceBanner', () => {
    it('affiche la progression active avec le message de tesla', () => {
        const { container } = render(<ApplicationBootSequenceBanner sequence={sequence()} />);

        expect(container.textContent).toContain('Démarrage des applications');
        expect(container.textContent).toContain('2/3 prêtes — tesla');
        expect(container.textContent).toContain('Déploiement en cours…');
        expect(container.textContent).toContain('67%');
        expect(container.querySelector('.onboarding-deploy-shimmer')).toBeTruthy();
    });

    it('ne rend rien quand la séquence est inactive', () => {
        const { container } = render(
            <ApplicationBootSequenceBanner sequence={sequence({ active: false, status: 'idle', total: 0, items: [] })} />,
        );

        expect(container.textContent).toBe('');
    });
});
