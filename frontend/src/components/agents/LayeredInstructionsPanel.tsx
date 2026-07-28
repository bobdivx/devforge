import { useEffect, useState } from 'preact/hooks';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';
import { useTeamContext } from '../../lib/team-context';

type Layers = { org: string; personal: string; project: string };

export function LayeredInstructionsPanel() {
    const { agentsEnabled } = useTeamContext();
    const [layers, setLayers] = useState<Layers>({ org: '', personal: '', project: '' });
    const [resourceUuid, setResourceUuid] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const load = async () => {
        if (!agentsEnabled) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const response = await domainApi.agentInstructions(resourceUuid.trim() || undefined);
            setLayers(response.data);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible de charger les instructions.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, [agentsEnabled]);

    const save = async () => {
        setSaving(true);
        setError(null);
        setSaved(false);
        try {
            const response = await domainApi.updateAgentInstructions({
                org: layers.org,
                personal: layers.personal,
                project: layers.project,
                ...(resourceUuid.trim() ? { resource_uuid: resourceUuid.trim() } : {}),
            });
            setLayers(response.data);
            setSaved(true);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible d’enregistrer.');
        } finally {
            setSaving(false);
        }
    };

    if (!agentsEnabled) {
        return null;
    }

    return (
        <div class="grid gap-4">
            <p class="text-xs text-base-content/60">
                Instructions injectées dans tous les prompts agents : organisation (équipe), personnelles, puis projet.
            </p>

            {error && <p class="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>}
            {saved && <p class="text-xs text-success">Instructions enregistrées.</p>}

            <label class="grid gap-1 text-xs">
                <span class="font-medium">UUID ressource (instructions projet, optionnel)</span>
                <div class="flex gap-2">
                    <input
                        class="input input-bordered input-sm flex-1"
                        value={resourceUuid}
                        placeholder="uuid application…"
                        onInput={(e) => setResourceUuid((e.target as HTMLInputElement).value)}
                    />
                    <button type="button" class="btn btn-ghost btn-sm" disabled={loading} onClick={() => void load()}>
                        Charger
                    </button>
                </div>
            </label>

            <label class="grid gap-1 text-xs">
                <span class="font-medium">Organisation</span>
                <textarea
                    class="textarea textarea-bordered textarea-sm min-h-24"
                    value={layers.org}
                    disabled={loading}
                    placeholder="Conventions d’équipe, stack, règles ops…"
                    onInput={(e) => setLayers({ ...layers, org: (e.target as HTMLTextAreaElement).value })}
                />
            </label>

            <label class="grid gap-1 text-xs">
                <span class="font-medium">Personnelles</span>
                <textarea
                    class="textarea textarea-bordered textarea-sm min-h-20"
                    value={layers.personal}
                    disabled={loading}
                    placeholder="Préférences individuelles…"
                    onInput={(e) => setLayers({ ...layers, personal: (e.target as HTMLTextAreaElement).value })}
                />
            </label>

            <label class="grid gap-1 text-xs">
                <span class="font-medium">Projet</span>
                <textarea
                    class="textarea textarea-bordered textarea-sm min-h-20"
                    value={layers.project}
                    disabled={loading || resourceUuid.trim() === ''}
                    placeholder="Spécifique à une app (renseignez l’UUID ci-dessus)…"
                    onInput={(e) => setLayers({ ...layers, project: (e.target as HTMLTextAreaElement).value })}
                />
            </label>

            <div>
                <button type="button" class="btn btn-primary btn-sm" disabled={saving || loading} onClick={() => void save()}>
                    {saving ? 'Enregistrement…' : 'Enregistrer les instructions'}
                </button>
            </div>
        </div>
    );
}
