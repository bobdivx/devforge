import { useEffect, useState } from 'preact/hooks';
import type { AiProviderConfig, LlmModelOption } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';

type Props = {
    providers: AiProviderConfig[];
    providerConfigId: number | null | undefined;
    fallbackProviderConfigId?: number | null | undefined;
    preferredModel?: string | null | undefined;
    showFallback?: boolean;
    onProviderChange: (providerId: number | null) => void;
    onFallbackChange?: (providerId: number | null) => void;
    onPreferredModelChange: (model: string | null) => void;
};

function providerOptionLabel(p: AiProviderConfig): string {
    const host = p.base_url ? ` · ${p.base_url.replace(/^https?:\/\//, '')}` : '';
    return `${p.name} (${p.provider}${host})`;
}

export function AgentProviderModelFields({
    providers,
    providerConfigId,
    fallbackProviderConfigId,
    preferredModel,
    showFallback = true,
    onProviderChange,
    onFallbackChange,
    onPreferredModelChange,
}: Props) {
    const [models, setModels] = useState<LlmModelOption[]>([]);
    const [loadingModels, setLoadingModels] = useState(false);

    const selected = providers.find((p) => p.id === providerConfigId) ?? null;

    useEffect(() => {
        if (!selected) {
            setModels([]);
            return;
        }

        let cancelled = false;
        setLoadingModels(true);
        domainApi.discoverAiProviderModels({
            provider: selected.provider,
            provider_id: selected.id,
            base_url: selected.base_url,
        })
            .then((r) => {
                if (!cancelled) {
                    setModels(r.data.models ?? []);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setModels([]);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingModels(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [selected?.id, selected?.provider, selected?.base_url]);

    return (
        <div class="grid gap-3">
            <label class="grid gap-1 text-xs">
                <span class="font-medium">Provider LLM (instance)</span>
                <select
                    class="select select-bordered select-sm"
                    value={providerConfigId ?? ''}
                    onChange={(e) => {
                        const v = (e.target as HTMLSelectElement).value;
                        onProviderChange(v ? Number(v) : null);
                        onPreferredModelChange(null);
                    }}
                >
                    <option value="">Auto (provider par défaut)</option>
                    {providers.map((p) => (
                        <option key={p.id} value={p.id}>{providerOptionLabel(p)}</option>
                    ))}
                </select>
                <span class="text-[11px] text-base-content/50">
                    Pour Ollama : une URL = une machine (ex. PC 3090 vs NAS A2000).
                </span>
            </label>

            <label class="grid gap-1 text-xs">
                <span class="font-medium">Modèle pour cet agent</span>
                <select
                    class="select select-bordered select-sm font-mono"
                    value={preferredModel ?? ''}
                    disabled={!selected}
                    onChange={(e) => {
                        const v = (e.target as HTMLSelectElement).value;
                        onPreferredModelChange(v || null);
                    }}
                >
                    <option value="">Auto (meilleur modèle du provider)</option>
                    {preferredModel && !models.some((m) => m.id === preferredModel) && (
                        <option value={preferredModel}>{preferredModel}</option>
                    )}
                    {models.map((m) => (
                        <option key={m.id} value={m.id}>{m.label || m.id}</option>
                    ))}
                </select>
                {loadingModels && <span class="text-[10px] text-base-content/45">Chargement des modèles…</span>}
                {!selected && (
                    <span class="text-[11px] text-base-content/50">Choisissez d’abord un provider pour lister les modèles.</span>
                )}
            </label>

            {showFallback && onFallbackChange && (
                <label class="grid gap-1 text-xs">
                    <span class="font-medium">Provider de secours</span>
                    <select
                        class="select select-bordered select-sm"
                        value={fallbackProviderConfigId ?? ''}
                        onChange={(e) => {
                            const v = (e.target as HTMLSelectElement).value;
                            onFallbackChange(v ? Number(v) : null);
                        }}
                    >
                        <option value="">Automatique</option>
                        {providers
                            .filter((p) => p.id !== providerConfigId)
                            .map((p) => (
                                <option key={p.id} value={p.id}>{providerOptionLabel(p)}</option>
                            ))}
                    </select>
                </label>
            )}
        </div>
    );
}
