import { RefreshCw } from 'lucide-preact';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { DataState } from '../components/ui/DataState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { domainApi } from '../lib/domain-api';
import { useApiQuery } from '../lib/use-api-query';

export function SecurityPage({ embedded = false }: { embedded?: boolean }) {
    const query = useApiQuery('security-keys', () => domainApi.securityKeys());
    const keys = query.data?.data ?? [];

    return (
        <>
            {!embedded && (
                <PageHeader
                    title="Sécurité"
                    description="Clés privées accessibles à l’équipe active."
                    actions={(
                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                            <RefreshCw class="size-3.5" aria-hidden />
                            Actualiser
                        </button>
                    )}
                />
            )}
            {embedded && (
                <div class="flex items-center justify-between gap-2">
                    <p class="text-xs text-base-content/55">Clés privées accessibles à l’équipe active.</p>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </div>
            )}
            <DataState loading={query.loading} error={query.error} empty={keys.length === 0} emptyMessage="Aucune clé privée." onRetry={() => void query.reload()}>
                <div class="grid gap-2 md:grid-cols-2">
                    {keys.map((key) => (
                        <Card title={key.name} eyebrow={key.is_git_related ? 'Git' : 'SSH'} key={key.uuid}>
                            <p class="text-xs text-base-content/55">{key.description || 'Sans description'}</p>
                            <div class="flex items-center justify-between gap-2">
                                <code class="truncate text-[11px] text-base-content/45">{key.fingerprint || 'Empreinte indisponible'}</code>
                                <StatusBadge label="Masquée" />
                            </div>
                        </Card>
                    ))}
                </div>
            </DataState>
        </>
    );
}
