import { Mail } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { Modal } from '../ui/Modal';

type InviteMemberModalProps = {
    open: boolean;
    onClose: () => void;
    onSubmit: (input: { email: string; role: string; via: 'email' | 'link' }) => Promise<{ link: string | null }>;
};

const roleOptions = [
    { value: 'member', label: 'Membre (lecture seule)' },
    { value: 'admin', label: 'Administrateur' },
    { value: 'owner', label: 'Propriétaire' },
];

export function InviteMemberModal({ open, onClose, onSubmit }: InviteMemberModalProps) {
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('member');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generatedLink, setGeneratedLink] = useState<string | null>(null);

    const reset = () => {
        setEmail('');
        setRole('member');
        setError(null);
        setGeneratedLink(null);
    };

    return (
        <Modal
            open={open}
            title="Inviter un membre"
            onClose={() => {
                reset();
                onClose();
            }}
        >
            {generatedLink ? (
                <div class="grid gap-3">
                    <p class="text-sm text-base-content/70">Lien d’invitation généré. Copiez-le et partagez-le avec la personne invitée.</p>
                    <code class="block overflow-x-auto rounded-xl bg-base-200/60 p-3 text-xs">{generatedLink}</code>
                    <div class="flex justify-end">
                        <button class="btn btn-primary btn-sm" type="button" onClick={() => { reset(); onClose(); }}>
                            Fermer
                        </button>
                    </div>
                </div>
            ) : (
                <form
                    class="grid gap-3"
                    onSubmit={async (event) => {
                        event.preventDefault();
                        setSaving(true);
                        setError(null);
                        try {
                            const result = await onSubmit({ email: email.trim(), role, via: 'email' });
                            if (result.link) {
                                setGeneratedLink(result.link);
                            } else {
                                reset();
                                onClose();
                            }
                        } catch {
                            setError('L’invitation a échoué. Vérifiez l’adresse e-mail et le rôle sélectionné.');
                        } finally {
                            setSaving(false);
                        }
                    }}
                >
                    <label class="form-control w-full">
                        <span class="label-text text-xs font-medium">Adresse e-mail</span>
                        <input
                            class="input input-bordered input-sm w-full"
                            type="email"
                            value={email}
                            required
                            onInput={(event) => setEmail((event.currentTarget as HTMLInputElement).value)}
                        />
                    </label>
                    <label class="form-control w-full">
                        <span class="label-text text-xs font-medium">Rôle</span>
                        <select
                            class="select select-bordered select-sm w-full"
                            value={role}
                            onChange={(event) => setRole((event.currentTarget as HTMLSelectElement).value)}
                        >
                            {roleOptions.map((option) => (
                                <option value={option.value} key={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>
                    {error && <div class="alert alert-error min-h-8 py-1 text-xs" role="alert">{error}</div>}
                    <div class="form-actions">
                        <button
                            class="btn btn-ghost btn-sm"
                            type="button"
                            disabled={saving || !email.trim()}
                            onClick={async () => {
                                setSaving(true);
                                setError(null);
                                try {
                                    const result = await onSubmit({ email: email.trim(), role, via: 'link' });
                                    setGeneratedLink(result.link);
                                } catch {
                                    setError('La génération du lien a échoué.');
                                } finally {
                                    setSaving(false);
                                }
                            }}
                        >
                            Générer un lien
                        </button>
                        <button class="btn btn-primary btn-sm" type="submit" disabled={saving || !email.trim()}>
                            <Mail class="size-3.5" aria-hidden />
                            {saving ? 'Envoi…' : 'Envoyer par e-mail'}
                        </button>
                    </div>
                </form>
            )}
        </Modal>
    );
}
