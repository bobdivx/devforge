import { Copy, Plus, RefreshCw, Rocket, Trash2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { ActionToolbar } from '../../components/ui/ActionToolbar';
import { TagFormModal } from '../../components/tags/TagFormModal';
import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataState } from '../../components/ui/DataState';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Table } from '../../components/ui/Table';
import type { BootstrapPermissions } from '../../lib/bootstrap';
import { domainApi } from '../../lib/domain-api';
import { extractTagName } from '../../lib/server-sections';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo } from '../../lib/use-navigate';

type TagsPageProps = {
    path: string;
    permissions: BootstrapPermissions;
    legacyBaseUrl?: string;
};

export function TagsPage({ path, permissions }: TagsPageProps) {
    const tagName = extractTagName(path);
    const canManage = permissions.create_resources;

    if (tagName) {
        return <TagDetailPage tagName={tagName} canManage={canManage} />;
    }

    const tags = useApiQuery('tags', () => domainApi.tags());
    const [createOpen, setCreateOpen] = useState(false);
    const [mutationError, setMutationError] = useState<string | null>(null);

    const reload = async () => {
        setMutationError(null);
        await tags.reload();
    };

    return (
        <div class="grid gap-5">
            <PageHeader
                title="Tags"
                description="Regroupez applications et services pour les déploiements par tag."
                actions={canManage ? (
                    <button class="btn btn-primary btn-sm" type="button" onClick={() => setCreateOpen(true)}>
                        <Plus class="size-3.5" aria-hidden />
                        Nouveau tag
                    </button>
                ) : undefined}
            />
            <Card title="Tags de l’équipe">
                <div class="card-toolbar mb-3">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </div>
                {mutationError && <div class="alert alert-error mb-3 min-h-8 py-1 text-xs" role="alert">{mutationError}</div>}
                <DataState
                    loading={tags.loading}
                    error={tags.error}
                    empty={(tags.data?.data.length ?? 0) === 0}
                    emptyMessage="Aucun tag configuré."
                    onRetry={() => void reload()}
                >
                    <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {(tags.data?.data ?? []).map((tag) => (
                            <button
                                class="rounded-2xl border border-base-300/70 p-4 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md"
                                type="button"
                                key={tag.name}
                                onClick={() => navigateTo(`/tags/${encodeURIComponent(tag.name)}`)}
                            >
                                <p class="truncate text-sm font-semibold">{tag.name}</p>
                                <p class="mt-2 text-xs text-base-content/55">
                                    {tag.applications_count} application(s) · {tag.services_count} service(s)
                                </p>
                            </button>
                        ))}
                    </div>
                </DataState>
            </Card>
            {canManage && (
                <TagFormModal
                    open={createOpen}
                    onClose={() => setCreateOpen(false)}
                    onSubmit={async (name) => {
                        try {
                            const response = await domainApi.createTag(name);
                            await reload();
                            navigateTo(`/tags/${encodeURIComponent(response.data.name)}`);
                        } catch {
                            setMutationError('La création a échoué. Vérifiez le nom du tag.');
                            throw new Error('create failed');
                        }
                    }}
                />
            )}
        </div>
    );
}

function TagDetailPage({ tagName, canManage }: { tagName: string; canManage: boolean }) {
    const tag = useApiQuery(`tag:${tagName}`, () => domainApi.tag(tagName));
    const data = tag.data?.data;
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [redeployOpen, setRedeployOpen] = useState(false);
    const [mutationError, setMutationError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [redeploying, setRedeploying] = useState(false);
    const [copied, setCopied] = useState(false);

    const hasResources = (data?.applications_count ?? 0) + (data?.services_count ?? 0) > 0;

    const copyWebhook = async () => {
        if (!data?.webhook_url) {
            return;
        }

        try {
            await navigator.clipboard.writeText(data.webhook_url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            setMutationError('Impossible de copier le webhook dans le presse-papiers.');
        }
    };

    return (
        <div class="grid gap-5">
            <PageHeader
                title={data?.name ?? tagName}
                description="Applications et services associés à ce tag."
                actions={canManage ? (
                    <ActionToolbar>
                        <button
                            class="btn btn-primary btn-sm"
                            type="button"
                            disabled={!hasResources || redeploying}
                            onClick={() => setRedeployOpen(true)}
                        >
                            <Rocket class="size-3.5" aria-hidden />
                            {redeploying ? 'Déploiement…' : 'Tout redéployer'}
                        </button>
                        <button
                            class="btn btn-outline btn-error btn-sm"
                            type="button"
                            disabled={hasResources}
                            onClick={() => setDeleteOpen(true)}
                            title={hasResources ? 'Détachez toutes les ressources avant de supprimer.' : undefined}
                        >
                            <Trash2 class="size-3.5" aria-hidden />
                            Supprimer
                        </button>
                    </ActionToolbar>
                ) : undefined}
            />
            {mutationError && <div class="alert alert-error min-h-8 py-1 text-xs" role="alert">{mutationError}</div>}
            {successMessage && <div class="alert alert-success min-h-8 py-1 text-xs" role="status">{successMessage}</div>}
            <DataState loading={tag.loading} error={tag.error} onRetry={() => void tag.reload()}>
                {data && (
                    <>
                        <Card title="Webhook de déploiement">
                            <div class="flex flex-col gap-2 sm:flex-row sm:items-start">
                                <code class="block flex-1 overflow-x-auto rounded-xl bg-base-200/60 p-3 text-xs">{data.webhook_url}</code>
                                <button class="btn btn-ghost btn-sm shrink-0" type="button" onClick={() => void copyWebhook()}>
                                    <Copy class="size-3.5" aria-hidden />
                                    {copied ? 'Copié' : 'Copier'}
                                </button>
                            </div>
                        </Card>
                        <Card title={`Applications (${data.applications_count})`}>
                            {data.applications.length === 0 ? (
                                <p class="text-sm text-base-content/55">Aucune application avec ce tag.</p>
                            ) : (
                                <Table headers={['Nom', 'Domaine', 'Statut']} caption="Applications taguées">
                                    {data.applications.map((application) => (
                                        <tr key={application.uuid}>
                                            <td>{application.name}</td>
                                            <td class="truncate text-xs">{application.fqdn ?? '—'}</td>
                                            <td><StatusBadge label={application.status ?? 'inconnu'} /></td>
                                        </tr>
                                    ))}
                                </Table>
                            )}
                        </Card>
                        <Card title={`Services (${data.services_count})`}>
                            {data.services.length === 0 ? (
                                <p class="text-sm text-base-content/55">Aucun service avec ce tag.</p>
                            ) : (
                                <Table headers={['Nom', 'Statut']} caption="Services tagués">
                                    {data.services.map((service) => (
                                        <tr key={service.uuid}>
                                            <td>{service.name}</td>
                                            <td><StatusBadge label={service.status ?? 'inconnu'} /></td>
                                        </tr>
                                    ))}
                                </Table>
                            )}
                        </Card>
                    </>
                )}
            </DataState>
            {canManage && (
                <>
                    <ConfirmDialog
                        open={deleteOpen}
                        title="Supprimer ce tag ?"
                        message="Cette action est irréversible. Le tag doit être vide pour être supprimé."
                        confirmLabel="Supprimer"
                        tone="danger"
                        onCancel={() => setDeleteOpen(false)}
                        onConfirm={async () => {
                            setMutationError(null);
                            try {
                                await domainApi.deleteTag(tagName);
                                navigateTo('/tags');
                            } catch {
                                setMutationError('La suppression a échoué. Détachez toutes les ressources liées au tag.');
                                throw new Error('delete failed');
                            }
                        }}
                    />
                    <ConfirmDialog
                        open={redeployOpen}
                        title="Redéployer toutes les ressources ?"
                        message={`Lancer le déploiement de ${data?.applications_count ?? 0} application(s) et ${data?.services_count ?? 0} service(s) associés au tag « ${tagName} ».`}
                        confirmLabel="Redéployer"
                        onCancel={() => setRedeployOpen(false)}
                        onConfirm={async () => {
                            setMutationError(null);
                            setSuccessMessage(null);
                            setRedeploying(true);
                            try {
                                const response = await domainApi.redeployTag(tagName);
                                const { applications_queued, services_queued } = response.data;
                                setSuccessMessage(
                                    `Déploiement lancé : ${applications_queued} application(s) et ${services_queued} service(s) mis en file.`,
                                );
                                await tag.reload();
                            } catch {
                                setMutationError('Le redéploiement a échoué. Vérifiez les permissions et la file de déploiement.');
                                throw new Error('redeploy failed');
                            } finally {
                                setRedeploying(false);
                            }
                        }}
                    />
                </>
            )}
        </div>
    );
}
