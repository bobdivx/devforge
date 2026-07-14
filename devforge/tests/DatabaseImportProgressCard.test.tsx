import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseImportProgressCard } from '../src/components/databases/DatabaseImportProgressCard';

afterEach(() => {
    cleanup();
});

describe('DatabaseImportProgressCard', () => {
    it('affiche les étapes et la progression pendant l’import', () => {
        render(
            <DatabaseImportProgressCard
                progress={{
                    fileName: 'backup.db',
                    fileSize: 2_048_000,
                    phase: 'importing',
                    percent: 62,
                    format: 'db',
                }}
            />,
        );

        expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByText('Importation en cours')).toBeInTheDocument();
        expect(screen.getByText('backup.db')).toBeInTheDocument();
        expect(screen.getAllByText('Import des données').length).toBeGreaterThan(0);
        expect(screen.getByText('62%')).toBeInTheDocument();
    });

    it('affiche l’état terminé', () => {
        render(
            <DatabaseImportProgressCard
                progress={{
                    fileName: 'dump.sql',
                    fileSize: 12_000,
                    phase: 'done',
                    percent: 100,
                    format: 'sql',
                }}
            />,
        );

        expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'false');
        expect(screen.getByText('Import terminé')).toBeInTheDocument();
        expect(screen.getByText('100%')).toBeInTheDocument();
    });
});
