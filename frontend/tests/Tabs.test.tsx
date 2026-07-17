import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tabs } from '../src/components/ui/Tabs';

afterEach(() => {
    cleanup();
});

describe('Tabs', () => {
    it('affiche un select mobile et des onglets desktop', () => {
        const onChange = vi.fn();

        render(
            <Tabs
                active="deployments"
                items={[
                    { id: 'overview', label: 'Vue d’ensemble' },
                    { id: 'deployments', label: 'Déploiements' },
                    { id: 'databases', label: 'Bases de données' },
                ]}
                onChange={onChange}
            />,
        );

        const select = screen.getByRole('combobox');
        expect(select).toHaveValue('deployments');

        fireEvent.change(select, { target: { value: 'databases' } });
        expect(onChange).toHaveBeenCalledWith('databases');

        expect(screen.getByRole('tab', { name: 'Déploiements' })).toHaveAttribute('aria-selected', 'true');
    });
});
