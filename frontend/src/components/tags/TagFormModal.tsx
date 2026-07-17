import { Save } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { Modal } from '../ui/Modal';

type TagFormModalProps = {
    open: boolean;
    onClose: () => void;
    onSubmit: (name: string) => Promise<void>;
};

export function TagFormModal({ open, onClose, onSubmit }: TagFormModalProps) {
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }

        setName('');
        setError(null);
    }, [open]);

    return (
        <Modal open={open} title="Nouveau tag" onClose={onClose}>
            <form
                class="grid gap-3"
                onSubmit={async (event) => {
                    event.preventDefault();
                    setSaving(true);
                    setError(null);
                    try {
                        await onSubmit(name.trim());
                        onClose();
                    } catch {
                        setError('La création a échoué. Le nom doit contenir au moins 2 caractères.');
                    } finally {
                        setSaving(false);
                    }
                }}
            >
                <label class="form-control w-full">
                    <span class="label-text text-xs font-medium">Nom du tag</span>
                    <input
                        class="input input-bordered input-sm w-full"
                        type="text"
                        value={name}
                        onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)}
                        placeholder="production"
                        minLength={2}
                        required
                        autoFocus
                    />
                    <span class="label-text-alt text-xs text-base-content/55">Minuscules, min. 2 caractères.</span>
                </label>
                {error && <div class="alert alert-error min-h-8 py-1 text-xs" role="alert">{error}</div>}
                <div class="form-actions">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={onClose} disabled={saving}>
                        Annuler
                    </button>
                    <button class="btn btn-primary btn-sm" type="submit" disabled={saving || name.trim().length < 2}>
                        <Save class="size-3.5" aria-hidden />
                        {saving ? 'Création…' : 'Créer'}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
