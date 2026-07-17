import { Save } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { Modal } from '../ui/Modal';
import { domainApi, type CoreResource, type DestinationDetail, type DestinationInput, type DestinationUpdateInput } from '../../lib/domain-api';

type DestinationFormModalProps = {
    open: boolean;
    mode: 'create' | 'edit';
    destination?: DestinationDetail | null;
    onClose: () => void;
    onSubmit: (input: DestinationInput | DestinationUpdateInput) => Promise<void>;
};

export function DestinationFormModal({
    open,
    mode,
    destination = null,
    onClose,
    onSubmit,
}: DestinationFormModalProps) {
    const [name, setName] = useState('');
    const [network, setNetwork] = useState('');
    const [serverUuid, setServerUuid] = useState('');
    const [type, setType] = useState<'standalone' | 'swarm'>('standalone');
    const [servers, setServers] = useState<CoreResource[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }

        setName(destination?.name ?? '');
        setNetwork(destination?.network ?? '');
        setServerUuid(destination?.server.uuid ?? '');
        setType(destination?.type ?? 'standalone');
        setError(null);

        if (mode === 'create') {
            void domainApi.coreResources('servers')
                .then((response) => setServers(response.data))
                .catch(() => setError('Impossible de charger les serveurs.'));
        }
    }, [destination, mode, open]);

    return (
        <Modal
            open={open}
            title={mode === 'create' ? 'Nouvelle destination' : `Modifier ${destination?.name ?? ''}`}
            onClose={onClose}
        >
            <form
                class="grid gap-3"
                onSubmit={async (event) => {
                    event.preventDefault();
                    setSaving(true);
                    setError(null);
                    try {
                        if (mode === 'create') {
                            await onSubmit({
                                server_uuid: serverUuid,
                                network,
                                name: name || null,
                                type,
                            } satisfies DestinationInput);
                        } else {
                            await onSubmit({
                                name,
                                network,
                            } satisfies DestinationUpdateInput);
                        }
                        onClose();
                    } catch (caught) {
                        setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
                    } finally {
                        setSaving(false);
                    }
                }}
            >
                {mode === 'create' && (
                    <>
                        <label class="grid gap-1 text-xs">
                            <span>Serveur</span>
                            <select
                                class="select select-bordered select-sm w-full"
                                required
                                value={serverUuid}
                                onChange={(event) => setServerUuid(event.currentTarget.value)}
                            >
                                <option value="">Sélectionner un serveur</option>
                                {servers.map((server) => (
                                    <option key={server.uuid} value={server.uuid}>{server.name}</option>
                                ))}
                            </select>
                        </label>
                        <label class="grid gap-1 text-xs">
                            <span>Type</span>
                            <select
                                class="select select-bordered select-sm w-full"
                                value={type}
                                onChange={(event) => setType(event.currentTarget.value as 'standalone' | 'swarm')}
                            >
                                <option value="standalone">Standalone</option>
                                <option value="swarm">Swarm</option>
                            </select>
                        </label>
                    </>
                )}
                <label class="grid gap-1 text-xs">
                    <span>Nom</span>
                    <input
                        class="input input-bordered input-sm w-full"
                        required={mode === 'edit'}
                        maxLength={255}
                        value={name}
                        placeholder={mode === 'create' ? 'Optionnel — généré automatiquement si vide' : undefined}
                        onInput={(event) => setName(event.currentTarget.value)}
                    />
                </label>
                <label class="grid gap-1 text-xs">
                    <span>Réseau Docker</span>
                    <input
                        class="input input-bordered input-sm w-full font-mono"
                        required
                        maxLength={255}
                        value={network}
                        onInput={(event) => setNetwork(event.currentTarget.value)}
                    />
                </label>
                {error && <p class="text-sm text-error">{error}</p>}
                <div class="form-actions">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>Annuler</button>
                    <button class="btn btn-primary btn-sm" type="submit" disabled={saving || network.trim() === '' || (mode === 'create' && serverUuid === '')}>
                        <Save class="size-3.5" aria-hidden />
                        {saving ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
