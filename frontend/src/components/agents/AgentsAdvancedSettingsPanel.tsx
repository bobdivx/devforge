import { useEffect, useState } from 'preact/hooks';
import { domainApi, type InstanceSettings } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type AgentsFlags = InstanceSettings['advanced']['agents'];

function defaults(): AgentsFlags {
    return {
        dynamic_roles_enabled: true,
        role_model_routing: true,
        collab_enabled: true,
        code_sandbox_enabled: true,
        mcp_client_enabled: true,
        mcp_servers: [],
    };
}

const FLAGS: Array<{ key: keyof AgentsFlags; label: string; description: string }> = [
    {
        key: 'dynamic_roles_enabled',
        label: 'Rôles dynamiques',
        description: 'spawn_task avec auto_roles / roles[]',
    },
    {
        key: 'role_model_routing',
        label: 'Routage modèle par rôle',
        description: 'Choisit un tier LLM selon researcher / implementer…',
    },
    {
        key: 'collab_enabled',
        label: 'Mode collaboration',
        description: 'Débat multi-rôles (interdit sur deploy/CI)',
    },
    {
        key: 'code_sandbox_enabled',
        label: 'Sandbox execute_code',
        description: 'Conteneur Docker éphémère pour du code isolé',
    },
];

export function AgentsAdvancedSettingsPanel({ canEdit }: { canEdit: boolean }) {
    const settings = useApiQuery('settings', () => domainApi.settings());
    const [form, setForm] = useState<AgentsFlags>(defaults());
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setForm(settings.data?.data.advanced.agents ?? defaults());
    }, [settings.data]);

    const save = async () => {
        if (!settings.data) {
            return;
        }
        setSaving(true);
        setMessage(null);
        setError(null);
        try {
            const advanced = settings.data.data.advanced;
            await domainApi.updateAdvancedSettings({
                ...advanced,
                agents: {
                    ...(advanced.agents ?? defaults()),
                    ...form,
                },
            });
            await settings.reload();
            setMessage('Paramètres avancés enregistrés.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div class="grid gap-3">
            {FLAGS.map((flag) => (
                <label key={flag.key} class="flex items-start gap-2 sm:gap-3 rounded-xl border border-base-300 bg-base-100 px-2.5 sm:px-3 py-2.5 sm:py-3">
                    <input
                        class="checkbox checkbox-sm mt-0.5"
                        type="checkbox"
                        checked={Boolean(form[flag.key])}
                        disabled={!canEdit || saving || settings.loading}
                        onChange={(e) => setForm((current) => ({
                            ...current,
                            [flag.key]: (e.target as HTMLInputElement).checked,
                        }))}
                    />
                    <span>
                        <span class="block text-xs sm:text-sm font-medium">{flag.label}</span>
                        <span class="mt-0.5 block text-[11px] text-base-content/55">{flag.description}</span>
                    </span>
                </label>
            ))}

            {error && <p class="text-xs text-error">{error}</p>}
            {message && <p class="text-xs text-success" role="status">{message}</p>}

            {canEdit && (
                <button class="btn btn-primary btn-sm w-fit" type="button" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
            )}
        </div>
    );
}
