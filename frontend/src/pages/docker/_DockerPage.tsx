import { useState } from 'preact/hooks';
import {
    ArrowUpCircle,
    Container,
    Info,
    Layers,
    Play,
    RefreshCw,
    RotateCw,
    Search,
    Square,
} from 'lucide-preact';
import { PageHeader } from '../../components/PageHeader';
import { DataState } from '../../components/ui/DataState';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { domainApi, type DockerImageCheckResult } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type TabId = 'containers' | 'images';

export function DockerPage() {
    const [activeTab, setActiveTab] = useState<TabId>('containers');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'exited'>('all');
    const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
    const [imageCheckResults, setImageCheckResults] = useState<Record<string, DockerImageCheckResult>>({});
    const [isCheckingAll, setIsCheckingAll] = useState(false);
    const [isUpdatingAll, setIsUpdatingAll] = useState(false);
    const [bannerMessage, setBannerMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

    const containersQuery = useApiQuery('docker-containers', () => domainApi.dockerContainers());
    const imagesQuery = useApiQuery('docker-images', () => domainApi.dockerImages());

    const containers = containersQuery.data?.data || [];
    const serverMeta = containersQuery.data?.meta?.server;
    const imagesData = imagesQuery.data?.data;
    const apps = imagesData?.applications || [];
    const services = imagesData?.services || [];

    const totalContainers = containers.length;
    const runningContainers = containers.filter((c) => c.State === 'running').length;
    const exitedContainers = containers.filter((c) => c.State === 'exited').length;
    const autoUpdateCount = (apps.filter((a) => a.is_image_auto_update_enabled).length) +
        (services.filter((s) => s.is_image_auto_update_enabled).length);

    const filteredContainers = containers.filter((container) => {
        if (statusFilter === 'running' && container.State !== 'running') return false;
        if (statusFilter === 'exited' && container.State !== 'exited') return false;
        if (searchQuery.trim() !== '') {
            const q = searchQuery.toLowerCase();
            const name = (container.Names || '').toLowerCase();
            const img = (container.Image || '').toLowerCase();
            const id = (container.ID || '').toLowerCase();
            return name.includes(q) || img.includes(q) || id.includes(q);
        }
        return true;
    });

    const setBusy = (key: string, busy: boolean) => {
        setActionLoading((prev) => ({ ...prev, [key]: busy }));
    };

    const handleContainerAction = async (containerId: string, action: 'start' | 'stop' | 'restart') => {
        if (!serverMeta?.uuid) return;
        const key = `${containerId}:${action}`;
        setBusy(key, true);
        setBannerMessage(null);
        try {
            const res = await domainApi.dockerContainerAction(serverMeta.uuid, containerId, action);
            setBannerMessage({ type: 'success', text: res.message || `Action ${action} effectuée.` });
            await containersQuery.reload();
        } catch (err: any) {
            setBannerMessage({ type: 'error', text: err?.message || `Échec de l'action ${action}.` });
        } finally {
            setBusy(key, false);
        }
    };

    const handleToggleAutoUpdate = async (type: 'application' | 'service', uuid: string, currentVal: boolean) => {
        const key = `toggle:${type}:${uuid}`;
        setBusy(key, true);
        try {
            await domainApi.dockerToggleAutoUpdate(type, uuid, !currentVal);
            await imagesQuery.reload();
        } catch (err: any) {
            setBannerMessage({ type: 'error', text: err?.message || 'Erreur lors de la modification.' });
        } finally {
            setBusy(key, false);
        }
    };

    const handleCheckUpdate = async (type: 'application' | 'service', uuid: string) => {
        const key = `check:${type}:${uuid}`;
        setBusy(key, true);
        try {
            const res = await domainApi.dockerCheckImageUpdates(type, uuid);
            setImageCheckResults((prev) => ({
                ...prev,
                [`${type}:${uuid}`]: res.data as DockerImageCheckResult,
            }));
            const updateAvailable = (res.data as DockerImageCheckResult)?.update_available;
            if (updateAvailable) {
                setBannerMessage({ type: 'info', text: 'Une mise à jour d’image est disponible pour cette ressource.' });
            } else {
                setBannerMessage({ type: 'success', text: 'L’image est déjà à jour.' });
            }
        } catch (err: any) {
            setBannerMessage({ type: 'error', text: err?.message || 'Échec de vérification de l’image.' });
        } finally {
            setBusy(key, false);
        }
    };

    const handleCheckAllUpdates = async () => {
        setIsCheckingAll(true);
        setBannerMessage(null);
        try {
            const res = await domainApi.dockerCheckImageUpdates();
            setImageCheckResults(res.data as Record<string, DockerImageCheckResult>);
            setBannerMessage({ type: 'success', text: 'Vérification de toutes les images terminée.' });
        } catch (err: any) {
            setBannerMessage({ type: 'error', text: err?.message || 'Erreur lors de la vérification globale.' });
        } finally {
            setIsCheckingAll(false);
        }
    };

    const handleUpdateImage = async (type: 'application' | 'service', uuid: string) => {
        const key = `update:${type}:${uuid}`;
        setBusy(key, true);
        setBannerMessage(null);
        try {
            const res = await domainApi.dockerUpdateImage(type, uuid);
            if (res.data?.status === 'updated') {
                setBannerMessage({ type: 'success', text: 'Mise à jour et redéploiement lancés avec succès.' });
            } else {
                setBannerMessage({ type: 'info', text: res.data?.reason || 'Mise à jour ignorée (déjà à jour).' });
            }
            await imagesQuery.reload();
        } catch (err: any) {
            setBannerMessage({ type: 'error', text: err?.message || 'Erreur lors du déclenchement de la mise à jour.' });
        } finally {
            setBusy(key, false);
        }
    };

    const handleUpdateAllImages = async () => {
        setIsUpdatingAll(true);
        setBannerMessage(null);
        try {
            const res = await domainApi.dockerUpdateAllImages();
            const updated = res.data?.updated ?? 0;
            setBannerMessage({ type: 'success', text: `Mises à jour déclenchées : ${updated} ressource(s).` });
            await imagesQuery.reload();
        } catch (err: any) {
            setBannerMessage({ type: 'error', text: err?.message || 'Erreur lors de la mise à jour groupée.' });
        } finally {
            setIsUpdatingAll(false);
        }
    };

    const reloadAll = async () => {
        await Promise.all([containersQuery.reload(), imagesQuery.reload()]);
    };

    return (
        <div class="space-y-6">
            <PageHeader
                title="Docker"
                description="Supervision des conteneurs et gestion des mises à jour automatiques d'images."
                actions={(
                    <div class="flex flex-wrap items-center gap-2">
                        {activeTab === 'containers' ? (
                            <button
                                class="btn btn-ghost btn-sm"
                                type="button"
                                onClick={() => void reloadAll()}
                                disabled={containersQuery.loading}
                            >
                                <RefreshCw class={`size-3.5 ${containersQuery.loading ? 'animate-spin' : ''}`} aria-hidden />
                                Actualiser
                            </button>
                        ) : (
                            <>
                                <button
                                    class="btn btn-ghost btn-sm"
                                    type="button"
                                    onClick={() => void handleCheckAllUpdates()}
                                    disabled={isCheckingAll}
                                >
                                    <RefreshCw class={`size-3.5 ${isCheckingAll ? 'animate-spin' : ''}`} aria-hidden />
                                    Vérifier toutes les images
                                </button>
                                <button
                                    class="btn btn-primary btn-sm"
                                    type="button"
                                    onClick={() => void handleUpdateAllImages()}
                                    disabled={isUpdatingAll}
                                >
                                    <ArrowUpCircle class="size-3.5" aria-hidden />
                                    Tout mettre à jour
                                </button>
                            </>
                        )}
                    </div>
                )}
            />

            {bannerMessage && (
                <div
                    class={`alert alert-${bannerMessage.type === 'error' ? 'error' : bannerMessage.type === 'success' ? 'success' : 'info'} text-xs shadow-sm`}
                >
                    <span>{bannerMessage.text}</span>
                </div>
            )}

            {/* Statistiques clés */}
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div class="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
                    <div class="text-xs font-medium uppercase text-base-content/60">Total Conteneurs</div>
                    <div class="mt-1 text-2xl font-bold">{totalContainers}</div>
                    <div class="mt-0.5 text-xs text-base-content/50">
                        {serverMeta?.name ? `Serveur : ${serverMeta.name}` : 'Hôte local'}
                    </div>
                </div>
                <div class="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
                    <div class="text-xs font-medium uppercase text-success">En cours d'exécution</div>
                    <div class="mt-1 text-2xl font-bold text-success">{runningContainers}</div>
                    <div class="mt-0.5 text-xs text-base-content/50">Actifs et en ligne</div>
                </div>
                <div class="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
                    <div class="text-xs font-medium uppercase text-base-content/60">Arrêtés / Exited</div>
                    <div class="mt-1 text-2xl font-bold">{exitedContainers}</div>
                    <div class="mt-0.5 text-xs text-base-content/50">Inactifs</div>
                </div>
                <div class="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
                    <div class="text-xs font-medium uppercase text-primary">Auto-Update Actif</div>
                    <div class="mt-1 text-2xl font-bold text-primary">{autoUpdateCount}</div>
                    <div class="mt-0.5 text-xs text-base-content/50">Apps & Services surveillés</div>
                </div>
            </div>

            {/* Navigation par onglets */}
            <div class="flex border-b border-base-300 gap-6">
                <button
                    type="button"
                    onClick={() => setActiveTab('containers')}
                    class={`pb-3 text-sm font-semibold transition-colors border-b-2 -mb-px flex items-center gap-2 cursor-pointer ${
                        activeTab === 'containers'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-base-content/60 hover:text-base-content'
                    }`}
                >
                    <Container class="size-4" />
                    <span>Conteneurs Docker ({totalContainers})</span>
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('images')}
                    class={`pb-3 text-sm font-semibold transition-colors border-b-2 -mb-px flex items-center gap-2 cursor-pointer ${
                        activeTab === 'images'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-base-content/60 hover:text-base-content'
                    }`}
                >
                    <Layers class="size-4" />
                    <span>Mises à jour des images ({apps.length + services.length})</span>
                </button>
            </div>

            {/* Onglet Conteneurs */}
            {activeTab === 'containers' && (
                <div class="space-y-4">
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div class="relative flex-1 max-w-md">
                            <input
                                type="text"
                                value={searchQuery}
                                onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                                placeholder="Rechercher par nom, image ou ID..."
                                class="input input-bordered input-sm w-full pl-9 text-xs"
                            />
                            <Search class="absolute left-2.5 top-2 size-4 text-base-content/40" />
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-xs text-base-content/60 font-medium">État :</span>
                            <div class="join">
                                <button
                                    type="button"
                                    onClick={() => setStatusFilter('all')}
                                    class={`btn btn-xs join-item ${statusFilter === 'all' ? 'btn-active' : 'btn-ghost'}`}
                                >
                                    Tous
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setStatusFilter('running')}
                                    class={`btn btn-xs join-item ${statusFilter === 'running' ? 'btn-active text-success' : 'btn-ghost'}`}
                                >
                                    Actifs
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setStatusFilter('exited')}
                                    class={`btn btn-xs join-item ${statusFilter === 'exited' ? 'btn-active' : 'btn-ghost'}`}
                                >
                                    Arrêtés
                                </button>
                            </div>
                        </div>
                    </div>

                    <DataState loading={containersQuery.loading && containers.length === 0} error={containersQuery.error} onRetry={() => void containersQuery.reload()}>
                        <div class="overflow-x-auto rounded-xl border border-base-300/80 bg-base-100 shadow-sm">
                            <table class="table table-sm min-w-full">
                                <thead>
                                    <tr class="bg-base-200/50 text-xs">
                                        <th>Nom & ID</th>
                                        <th>Image</th>
                                        <th>Statut</th>
                                        <th>Ports</th>
                                        <th>Uptime</th>
                                        <th class="text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredContainers.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} class="py-8 text-center text-xs text-base-content/50">
                                                {searchQuery ? `Aucun conteneur ne correspond à "${searchQuery}".` : 'Aucun conteneur trouvé.'}
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredContainers.map((container) => {
                                            const id = container.ID;
                                            const isManaged = (container.Labels || '').includes('devforge.managed') || (container.Labels || '').includes('coolify.managed');
                                            return (
                                                <tr key={id} class="hover:bg-base-200/40 transition-colors">
                                                    <td class="whitespace-nowrap">
                                                        <div class="flex items-center gap-1.5 font-medium text-xs">
                                                            {container.Names}
                                                            {isManaged && (
                                                                <span class="badge badge-primary badge-xs">DevForge</span>
                                                            )}
                                                        </div>
                                                        <div class="font-mono text-[10px] text-base-content/50">
                                                            {id.slice(0, 12)}
                                                        </div>
                                                    </td>
                                                    <td class="font-mono text-xs max-w-xs truncate" title={container.Image}>
                                                        {container.Image}
                                                    </td>
                                                    <td class="whitespace-nowrap">
                                                        <StatusBadge
                                                            label={container.State === 'running' ? 'En cours' : container.State === 'exited' ? 'Arrêté' : container.State}
                                                            tone={container.State === 'running' ? 'success' : container.State === 'exited' ? 'neutral' : 'warning'}
                                                        />
                                                        <div class="text-[10px] text-base-content/50 mt-0.5">{container.Status}</div>
                                                    </td>
                                                    <td class="font-mono text-[11px] text-base-content/70 max-w-xs truncate" title={container.Ports}>
                                                        {container.Ports || '-'}
                                                    </td>
                                                    <td class="text-xs text-base-content/60 whitespace-nowrap">
                                                        {container.RunningFor || '-'}
                                                    </td>
                                                    <td class="text-right whitespace-nowrap">
                                                        <div class="flex items-center justify-end gap-1.5">
                                                            {container.State === 'running' ? (
                                                                <>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void handleContainerAction(id, 'restart')}
                                                                        disabled={actionLoading[`${id}:restart`]}
                                                                        class="btn btn-ghost btn-xs"
                                                                    >
                                                                        <RotateCw class={`size-3 ${actionLoading[`${id}:restart`] ? 'animate-spin' : ''}`} />
                                                                        Redémarrer
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void handleContainerAction(id, 'stop')}
                                                                        disabled={actionLoading[`${id}:stop`]}
                                                                        class="btn btn-ghost btn-xs text-error"
                                                                    >
                                                                        <Square class="size-3" />
                                                                        Arrêter
                                                                    </button>
                                                                </>
                                                            ) : container.State === 'exited' ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleContainerAction(id, 'start')}
                                                                    disabled={actionLoading[`${id}:start`]}
                                                                    class="btn btn-ghost btn-xs text-success"
                                                                >
                                                                    <Play class="size-3" />
                                                                    Démarrer
                                                                </button>
                                                            ) : null}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </DataState>
                </div>
            )}

            {/* Onglet Mises à jour des images */}
            {activeTab === 'images' && (
                <div class="space-y-6">
                    <div class="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs leading-relaxed text-base-content/80 flex items-start gap-3">
                        <Info class="size-4 text-primary shrink-0 mt-0.5" />
                        <div>
                            <span class="font-semibold text-primary">Mise à jour automatique en arrière-plan :</span>{' '}
                            Les applications et services avec l'option <span class="font-semibold">Mise à jour auto</span> activée sont vérifiés périodiquement par la tâche <code class="font-mono bg-base-200 px-1 py-0.5 rounded text-[11px]">CheckDockerImageUpdatesJob</code>. Lorsqu'une nouvelle version est détectée sur le registre Docker distant, DevForge applique automatiquement le redéploiement.
                        </div>
                    </div>

                    <DataState loading={imagesQuery.loading && apps.length === 0 && services.length === 0} error={imagesQuery.error} onRetry={() => void imagesQuery.reload()}>
                        {/* Applications */}
                        <div class="space-y-3">
                            <div class="flex items-center justify-between">
                                <h3 class="text-sm font-semibold">Applications (Images Docker)</h3>
                                <span class="text-xs text-base-content/50">{apps.length} application(s)</span>
                            </div>

                            <div class="overflow-x-auto rounded-xl border border-base-300/80 bg-base-100 shadow-sm">
                                <table class="table table-sm min-w-full">
                                    <thead>
                                        <tr class="bg-base-200/50 text-xs">
                                            <th>Application</th>
                                            <th>Image configurée</th>
                                            <th class="text-center">Mise à jour auto</th>
                                            <th>Statut de version</th>
                                            <th class="text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {apps.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} class="py-8 text-center text-xs text-base-content/50">
                                                    Aucune application avec buildpack Image Docker trouvée.
                                                </td>
                                            </tr>
                                        ) : (
                                            apps.map((app) => {
                                                const checkKey = `application:${app.uuid}`;
                                                const check = imageCheckResults[checkKey];
                                                const isBusyCheck = actionLoading[`check:application:${app.uuid}`];
                                                const isBusyUpdate = actionLoading[`update:application:${app.uuid}`];
                                                const isBusyToggle = actionLoading[`toggle:application:${app.uuid}`];

                                                return (
                                                    <tr key={app.uuid} class="hover:bg-base-200/40 transition-colors">
                                                        <td class="whitespace-nowrap">
                                                            <div class="font-medium text-xs">{app.name}</div>
                                                            <div class="text-[11px] text-base-content/50">
                                                                {app.project || 'Projet'} / {app.environment || 'Environnement'}
                                                            </div>
                                                        </td>
                                                        <td class="font-mono text-xs whitespace-nowrap">
                                                            {app.image || 'image'}:{app.tag || 'latest'}
                                                        </td>
                                                        <td class="text-center whitespace-nowrap">
                                                            <input
                                                                type="checkbox"
                                                                class="toggle toggle-primary toggle-sm"
                                                                checked={app.is_image_auto_update_enabled}
                                                                disabled={isBusyToggle}
                                                                onChange={() => void handleToggleAutoUpdate('application', app.uuid, app.is_image_auto_update_enabled)}
                                                            />
                                                        </td>
                                                        <td class="whitespace-nowrap">
                                                            {!check ? (
                                                                <span class="text-xs text-base-content/40">Non vérifié</span>
                                                            ) : check.error ? (
                                                                <StatusBadge label="Erreur registre" tone="error" />
                                                            ) : check.update_available === true ? (
                                                                <StatusBadge label="Mise à jour dispo" tone="warning" />
                                                            ) : check.update_available === false ? (
                                                                <StatusBadge label="À jour" tone="success" />
                                                            ) : (
                                                                <span class="text-xs text-base-content/40">Inconclusif</span>
                                                            )}
                                                        </td>
                                                        <td class="text-right whitespace-nowrap">
                                                            <div class="flex items-center justify-end gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleCheckUpdate('application', app.uuid)}
                                                                    disabled={isBusyCheck}
                                                                    class="btn btn-ghost btn-xs"
                                                                >
                                                                    <RefreshCw class={`size-3 ${isBusyCheck ? 'animate-spin' : ''}`} />
                                                                    Vérifier
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleUpdateImage('application', app.uuid)}
                                                                    disabled={isBusyUpdate}
                                                                    class="btn btn-primary btn-xs"
                                                                >
                                                                    <ArrowUpCircle class="size-3" />
                                                                    Mettre à jour
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Services */}
                        <div class="space-y-3 mt-6">
                            <div class="flex items-center justify-between">
                                <h3 class="text-sm font-semibold">Services</h3>
                                <span class="text-xs text-base-content/50">{services.length} service(s)</span>
                            </div>

                            <div class="overflow-x-auto rounded-xl border border-base-300/80 bg-base-100 shadow-sm">
                                <table class="table table-sm min-w-full">
                                    <thead>
                                        <tr class="bg-base-200/50 text-xs">
                                            <th>Service</th>
                                            <th class="text-center">Mise à jour auto</th>
                                            <th>Statut de version</th>
                                            <th class="text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {services.length === 0 ? (
                                            <tr>
                                                <td colSpan={4} class="py-8 text-center text-xs text-base-content/50">
                                                    Aucun service trouvé.
                                                </td>
                                            </tr>
                                        ) : (
                                            services.map((svc) => {
                                                const checkKey = `service:${svc.uuid}`;
                                                const check = imageCheckResults[checkKey];
                                                const isBusyCheck = actionLoading[`check:service:${svc.uuid}`];
                                                const isBusyUpdate = actionLoading[`update:service:${svc.uuid}`];
                                                const isBusyToggle = actionLoading[`toggle:service:${svc.uuid}`];

                                                return (
                                                    <tr key={svc.uuid} class="hover:bg-base-200/40 transition-colors">
                                                        <td class="whitespace-nowrap">
                                                            <div class="font-medium text-xs">{svc.name}</div>
                                                            <div class="text-[11px] text-base-content/50">
                                                                {svc.project || 'Projet'} / {svc.environment || 'Environnement'}
                                                            </div>
                                                        </td>
                                                        <td class="text-center whitespace-nowrap">
                                                            <input
                                                                type="checkbox"
                                                                class="toggle toggle-primary toggle-sm"
                                                                checked={svc.is_image_auto_update_enabled}
                                                                disabled={isBusyToggle}
                                                                onChange={() => void handleToggleAutoUpdate('service', svc.uuid, svc.is_image_auto_update_enabled)}
                                                            />
                                                        </td>
                                                        <td class="whitespace-nowrap">
                                                            {!check ? (
                                                                <span class="text-xs text-base-content/40">Non vérifié</span>
                                                            ) : check.error ? (
                                                                <StatusBadge label="Erreur registre" tone="error" />
                                                            ) : check.update_available === true ? (
                                                                <StatusBadge label="Mise à jour dispo" tone="warning" />
                                                            ) : check.update_available === false ? (
                                                                <StatusBadge label="À jour" tone="success" />
                                                            ) : (
                                                                <span class="text-xs text-base-content/40">Inconclusif</span>
                                                            )}
                                                        </td>
                                                        <td class="text-right whitespace-nowrap">
                                                            <div class="flex items-center justify-end gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleCheckUpdate('service', svc.uuid)}
                                                                    disabled={isBusyCheck}
                                                                    class="btn btn-ghost btn-xs"
                                                                >
                                                                    <RefreshCw class={`size-3 ${isBusyCheck ? 'animate-spin' : ''}`} />
                                                                    Vérifier
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleUpdateImage('service', svc.uuid)}
                                                                    disabled={isBusyUpdate}
                                                                    class="btn btn-primary btn-xs"
                                                                >
                                                                    <ArrowUpCircle class="size-3" />
                                                                    Mettre à jour
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </DataState>
                </div>
            )}
        </div>
    );
}
