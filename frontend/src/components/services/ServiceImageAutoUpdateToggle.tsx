import { LoaderCircle } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { domainApi } from '../../lib/domain-api';

type Props = {
    serviceUuid: string;
    canAct: boolean;
    initialEnabled: boolean;
    onChanged: () => Promise<void>;
};

export function ServiceImageAutoUpdateToggle({
    serviceUuid,
    canAct,
    initialEnabled,
    onChanged,
}: Props) {
    const [enabled, setEnabled] = useState(initialEnabled);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setEnabled(initialEnabled);
    }, [initialEnabled, serviceUuid]);

    const save = async (value: boolean) => {
        if (!canAct || saving) {
            return;
        }

        setSaving(true);
        setError(null);
        const previous = enabled;
        setEnabled(value);

        try {
            const response = await domainApi.updateServiceSettings(serviceUuid, {
                is_image_auto_update_enabled: value,
            });
            setEnabled(response.data.is_image_auto_update_enabled);
            await onChanged();
        } catch (caught) {
            setEnabled(previous);
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div class="grid gap-2 rounded-xl border border-base-300/60 bg-base-200/30 px-2.5 sm:px-3 md:px-4 py-2.5 sm:py-3">
            <label class="flex items-start gap-3">
                <input
                    type="checkbox"
                    class="checkbox checkbox-sm mt-0.5"
                    checked={enabled}
                    disabled={!canAct || saving}
                    onChange={(event) => void save((event.target as HTMLInputElement).checked)}
                />
                <span class="min-w-0">
                    <span class="flex items-center gap-2 text-xs sm:text-sm font-medium">
                        Auto-update image Docker Hub
                        {saving && <LoaderCircle class="size-3.5 animate-spin text-base-content/45" aria-hidden />}
                    </span>
                    <span class="mt-0.5 block text-xs text-base-content/50">
                        Vérifie chaque heure les digests des images du service (Docker Hub / Quay)
                        et redéploie avec pull si une nouvelle image est disponible.
                    </span>
                </span>
            </label>
            {error && <p class="text-xs text-error" role="alert">{error}</p>}
        </div>
    );
}
