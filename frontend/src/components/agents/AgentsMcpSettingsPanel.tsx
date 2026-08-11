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

export function AgentsMcpSettingsPanel({ canEdit }: { canEdit: boolean }) {
    const settings = useApiQuery('settings', () => domainApi.settings());
    const agents = settings.data?.data.advanced.agents ?? defaults();
    const [enabled, setEnabled] = useState(agents.mcp_client_enabled);
    const [json, setJson] = useState(() => JSON.stringify(agents.mcp_servers ?? [], null, 2));
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const next = settings.data?.data.advanced.agents ?? defaults();
        setEnabled(next.mcp_client_enabled);
        setJson(JSON.stringify(next.mcp_servers ?? [], null, 2));
    }, [settings.data]);

    const save = async () => {
        if (!settings.data) {
            return;
        }
        setSaving(true);
        setMessage(null);
        setError(null);
        try {
            const parsed = JSON.parse(json || '[]');
            if (!Array.isArray(parsed)) {
                throw new Error('mcp_servers doit être un tableau JSON');
            }
            const advanced = settings.data.data.advanced;
            await domainApi.updateAdvancedSettings({
                ...advanced,
                agents: {
                    ...(advanced.agents ?? defaults()),
                    mcp_client_enabled: enabled,
                    mcp_servers: parsed,
                },
            });
            await settings.reload();
            setMessage('Configuration MCP enregistrée.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div class="grid gap-4">
            <label class="flex items-start gap-3 rounded-xl border border-base-300 bg-base-100 px-3 py-3">
                <input
                    class="checkbox checkbox-sm mt-0.5"
                    type="checkbox"
                    checked={enabled}
                    disabled={!canEdit || saving || settings.loading}
                    onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
                />
                <span>
                    <span class="block text-sm font-medium">Client MCP dans la boucle agent</span>
                    <span class="mt-0.5 block text-[11px] text-base-content/55">
                        Expose les outils distants comme <code class="text-[10px]">mcp__serveur__outil</code>.
                    </span>
                </span>
            </label>

            <label class="grid gap-1.5 text-xs">
                <span class="font-medium">Serveurs MCP (JSON)</span>
                <textarea
                    class="textarea textarea-bordered font-mono text-[11px]"
                    rows={10}
                    disabled={!canEdit || saving || !enabled}
                    value={json}
                    onInput={(e) => setJson((e.target as HTMLTextAreaElement).value)}
                    placeholder='[{"id":"docs","url":"https://example.com/mcp","label":"Docs"}]'
                />
            </label>

            {error && <p class="text-xs text-error">{error}</p>}
            {message && <p class="text-xs text-success" role="status">{message}</p>}

            {canEdit && (
                <button class="btn btn-primary btn-sm w-fit" type="button" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Enregistrement…' : 'Enregistrer MCP'}
                </button>
            )}
            {!canEdit && (
                <p class="text-xs text-base-content/50">Réservé aux admins d’équipe / instance.</p>
            )}
        </div>
    );
}
