import { Sparkles } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { Modal } from '../ui/Modal';
import { ApiError } from '../../lib/api-client';
import { domainApi } from '../../lib/domain-api';

type Props = {
    open: boolean;
    applicationUuid: string;
    applicationName: string;
    onClose: () => void;
    onCreated?: (missionUuid: string) => void;
};

export function ApplicationFeatureRequestModal({
    open,
    applicationUuid,
    applicationName,
    onClose,
    onCreated,
}: Props) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState('normal');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setTitle('');
        setDescription('');
        setPriority('normal');
        setError(null);
    };

    const close = () => {
        if (submitting) {
            return;
        }
        reset();
        onClose();
    };

    const submit = async () => {
        const nextTitle = title.trim();
        if (!nextTitle) {
            setError('Titre requis.');
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const response = await domainApi.createApplicationFeatureRequest(applicationUuid, {
                title: nextTitle,
                description: description.trim() || undefined,
                priority,
                dispatch_now: true,
            });
            onCreated?.(response.data.mission.uuid);
            reset();
            onClose();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Création impossible.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            open={open}
            title="Nouvelle fonctionnalité"
            onClose={close}
            footer={(
                <>
                    <button class="btn btn-ghost btn-sm" type="button" disabled={submitting} onClick={close}>
                        Annuler
                    </button>
                    <button class="btn btn-primary btn-sm gap-1" type="button" disabled={submitting} onClick={() => void submit()}>
                        <Sparkles class="size-3.5" aria-hidden />
                        {submitting ? 'Lancement…' : 'Lancer l’agent'}
                    </button>
                </>
            )}
        >
            <p class="text-xs text-base-content/60">
                L’agent ouvrira une PR sur <span class="font-medium text-base-content">{applicationName}</span>,
                déploiera une preview si possible, puis tu valideras le merge.
            </p>
            <label class="form-control w-full gap-1">
                <span class="label-text text-xs">Titre</span>
                <input
                    class="input input-bordered input-sm w-full"
                    maxLength={200}
                    placeholder="Ex. Mode sombre sur le dashboard"
                    value={title}
                    onInput={(event) => setTitle((event.target as HTMLInputElement).value)}
                />
            </label>
            <label class="form-control w-full gap-1">
                <span class="label-text text-xs">Description</span>
                <textarea
                    class="textarea textarea-bordered textarea-sm min-h-28 w-full"
                    maxLength={8000}
                    placeholder="Contexte, critères d’acceptation, contraintes…"
                    value={description}
                    onInput={(event) => setDescription((event.target as HTMLTextAreaElement).value)}
                />
            </label>
            <label class="form-control w-full max-w-xs gap-1">
                <span class="label-text text-xs">Priorité</span>
                <select
                    class="select select-bordered select-sm"
                    value={priority}
                    onChange={(event) => setPriority((event.target as HTMLSelectElement).value)}
                >
                    <option value="low">Basse</option>
                    <option value="normal">Normale</option>
                    <option value="high">Haute</option>
                    <option value="urgent">Urgente</option>
                </select>
            </label>
            {error && <p class="text-sm text-error">{error}</p>}
        </Modal>
    );
}
