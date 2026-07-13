import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ResourceStatusIcon } from '../src/components/ui/ResourceStatusIcon';

afterEach(() => {
    cleanup();
});

describe('ResourceStatusIcon', () => {
    it('affiche une icône accessible sans texte brut running:unknown', () => {
        render(<ResourceStatusIcon status="running:unknown" />);

        expect(screen.getByLabelText('En cours de fonctionnement')).toBeInTheDocument();
        expect(screen.queryByText('running:unknown')).not.toBeInTheDocument();
    });

    it('peut afficher un libellé court', () => {
        render(<ResourceStatusIcon status="running:healthy" showLabel />);

        expect(screen.getByText('Sain')).toBeInTheDocument();
    });
});
