import { render, screen, fireEvent } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../src/components/ui/ConfirmDialog';

describe('ConfirmDialog', () => {
    it('met le bouton principal en avant et le secondaire en ghost', () => {
        const onConfirm = vi.fn();
        const onSecondary = vi.fn();
        const onCancel = vi.fn();

        render(
            <ConfirmDialog
                open
                title="Déployer"
                message={(
                    <>
                        <p>Déployer « TeslaSphere » ?</p>
                        <ul>
                            <li>Reconstruire l’image — recommandé</li>
                            <li>Déployer (cache) — plus rapide</li>
                        </ul>
                    </>
                )}
                confirmLabel="Reconstruire l’image"
                secondaryConfirmLabel="Déployer (cache)"
                onConfirm={onConfirm}
                onSecondaryConfirm={onSecondary}
                onCancel={onCancel}
            />,
        );

        expect(screen.getByRole('button', { name: 'Reconstruire l’image' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Déployer (cache)' })).toBeTruthy();
        expect(screen.getByText(/recommandé/i)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Reconstruire l’image' }));
        expect(onConfirm).toHaveBeenCalledOnce();

        fireEvent.click(screen.getByRole('button', { name: 'Déployer (cache)' }));
        expect(onSecondary).toHaveBeenCalledOnce();
    });
});
