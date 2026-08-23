import { Copy, RefreshCw } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type WebhookResourceType = 'databases' | 'services';

type Props = {
    resourceType?: WebhookResourceType;
    resourceUuid?: string;
};

async function copyText(value: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch {
        return false;
    }
}

export function DatabaseWebhooksPanel({
    resourceType = 'databases',
    resourceUuid = '',
}: Props) {
    const uuid = resourceUuid;
    const resourceLabel = resourceType === 'services' ? 'ce service' : 'cette base de données';

    const query = useApiQuery(
        `resource-webhooks:${resourceType}:${uuid}`,
        () => domainApi.resourceWebhooks(resourceType, uuid),
    );
    const [copied, setCopied] = useState(false);
    const url = query.data?.data.deploy_webhook_url ?? '';

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-3 sm:px-3 sm:px-4 md:px-5 py-3 sm:py-3 sm:py-4">
                <div>
                    <p class="text-xs sm:text-sm font-semibold">Webhooks</p>
                    <p class="text-xs text-base-content/50">
                        Déploiement API de {resourceLabel}
                    </p>
                </div>
                <ActionToolbar>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </ActionToolbar>
            </div>

            <div class="grid gap-2.5 sm:gap-3 md:gap-2.5 sm:gap-3 md:gap-4 p-5">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    <label class="grid gap-1.5 text-sm">
                        <span class="font-medium text-base-content/80">Deploy webhook (authentification API requise)</span>
                        <span class="text-xs text-base-content/45">
                            Déclenche un redémarrage / déploiement via l’API.
                        </span>
                        <div class="flex flex-col gap-2 sm:flex-row">
                            <input class="input input-bordered w-full font-mono text-xs" readOnly value={url} />
                            <button
                                class="btn btn-ghost btn-sm border border-base-300/80"
                                type="button"
                                disabled={!url}
                                onClick={() => {
                                    void copyText(url).then((ok) => {
                                        if (ok) {
                                            setCopied(true);
                                            window.setTimeout(() => setCopied(false), 1500);
                                        }
                                    });
                                }}
                            >
                                <Copy class="size-3.5" aria-hidden />
                                {copied ? 'Copié' : 'Copier'}
                            </button>
                        </div>
                    </label>
                </DataState>
            </div>
        </section>
    );
}
