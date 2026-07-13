import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { DonutChart } from '../src/components/ui/DonutChart';
import { ProgressBar } from '../src/components/ui/ProgressBar';
import { Sparkline } from '../src/components/ui/Sparkline';

describe('composants graphiques dashboard', () => {
    it('rend DonutChart avec label central', () => {
        const { container } = render(
            <DonutChart
                centerLabel="82%"
                segments={[
                    { label: 'OK', value: 8, color: '#22c55e' },
                    { label: 'KO', value: 2, color: '#ef4444' },
                ]}
            />,
        );

        expect(container.textContent).toContain('82%');
        expect(container.querySelector('circle')).toBeTruthy();
    });

    it('rend ProgressBar avec pourcentage', () => {
        const { container } = render(<ProgressBar value={75} label="Santé" />);
        expect(container.textContent).toContain('75%');
    });

    it('rend Sparkline sans erreur', () => {
        const { container } = render(<Sparkline values={[1, 3, 2, 5, 4]} />);
        expect(container.querySelector('polyline')).toBeTruthy();
    });
});
