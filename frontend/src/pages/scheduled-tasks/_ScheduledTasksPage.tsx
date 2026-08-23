import { useState } from 'preact/hooks';
import { CalendarClock, AlertCircle, PlayCircle, RefreshCw, Server, Database, Box, Settings, ArrowRight } from 'lucide-preact';
import { PageHeader } from '../../components/PageHeader';
import { useApiQuery } from '../../lib/use-api-query';
import { domainApi } from '../../lib/domain-api';
import { DataState } from '../../components/ui/DataState';
import { formatDateTime } from '../../lib/application-config';
import { formatCron } from '../../lib/cron-utils';

type TabId = 'definitions' | 'executions' | 'skips' | 'manager';

export function ScheduledTasksPage() {
    const [activeTab, setActiveTab] = useState<TabId>('definitions');
    const [filterType, setFilterType] = useState('all');
    const [filterDate, setFilterDate] = useState('last_24h');
    const [skipPage, setSkipPage] = useState(0);

    const definitionsQuery = useApiQuery(
        'scheduled-jobs-definitions',
        () => domainApi.scheduledJobsDefinitions()
    );


    const dataQuery = useApiQuery(
        `scheduled-jobs-${filterType}-${filterDate}-${skipPage}`, 
        () => domainApi.scheduledJobs(filterType, filterDate, skipPage)
    );
    
    const data = dataQuery.data?.data;

    const renderExecutionType = (type: string) => {
        switch (type) {
            case 'task': return <span class="badge badge-primary badge-sm gap-1"><Box class="size-3" /> App Cron</span>;
            case 'backup': return <span class="badge badge-secondary badge-sm gap-1"><Database class="size-3" /> Backup</span>;
            case 'cleanup': return <span class="badge badge-accent badge-sm gap-1"><Server class="size-3" /> Cleanup</span>;
            default: return <span class="badge badge-ghost badge-sm">{type}</span>;
        }
    };

    const tabContent = (() => {
        switch (activeTab) {
            case 'definitions': {
                const defs = definitionsQuery.data?.data?.definitions;
                
                return (
                    <DataState 
                        loading={definitionsQuery.loading && !defs} 
                        error={definitionsQuery.error} 
                        onRetry={() => void definitionsQuery.reload()}
                    >
                        <div class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
                            <div class="overflow-x-auto">
                                <table class="table table-sm">
                                    <thead>
                                        <tr class="bg-base-200/50">
                                            <th>État</th>
                                            <th>Type</th>
                                            <th>Ressource</th>
                                            <th>Commande</th>
                                            <th>Fréquence</th>
                                            <th class="text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {!defs || defs.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} class="py-8 text-center text-base-content/50">
                                                    Aucun cron ou sauvegarde configuré pour cette équipe.
                                                </td>
                                            </tr>
                                        ) : (
                                            defs.map((def: any) => (
                                                <tr key={def.id}>
                                                    <td>
                                                        <span class={`badge badge-sm ${def.enabled ? 'badge-success' : 'badge-neutral'}`}>
                                                            {def.enabled ? 'Actif' : 'Désactivé'}
                                                        </span>
                                                    </td>
                                                    <td>{renderExecutionType(def.type)}</td>
                                                    <td>
                                                        <div class="font-medium text-sm flex items-center gap-2">
                                                            {def.resource_name}
                                                            {def.project_name && def.environment_name && (
                                                                <span class="text-[10px] bg-base-200 px-1.5 py-0.5 rounded-md text-base-content/70">
                                                                    {def.project_name} / {def.environment_name}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div class="text-[11px] text-base-content/60 mt-0.5">{def.name}</div>
                                                    </td>
                                                    <td class="font-mono text-xs max-w-xs truncate" title={def.command || ''}>
                                                        {def.command || '-'}
                                                    </td>
                                                    <td class="font-mono text-xs">
                                                        {formatCron(def.frequency)}
                                                    </td>
                                                    <td class="text-right">
                                                        {def.link && (
                                                            <a href={def.link} class="btn btn-ghost btn-xs text-primary group-hover:bg-primary/10">
                                                                Gérer <ArrowRight class="size-3" />
                                                            </a>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </DataState>
                );
            }
            case 'executions':
                if (!data) return null;
                return (
                    <div class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
                        <div class="overflow-x-auto">
                            <table class="table table-sm">
                                <thead>
                                    <tr class="bg-base-200/50">
                                        <th>Date</th>
                                        <th>Type</th>
                                        <th>Ressource</th>
                                        <th>Serveur</th>
                                        <th>Statut</th>
                                        <th>Détails</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.executions.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} class="py-8 text-center text-base-content/50">
                                                Aucune exécution (en échec) trouvée pour cette période.
                                            </td>
                                        </tr>
                                    ) : (
                                        data.executions.map((exec: any) => (
                                            <tr key={exec.id}>
                                                <td class="whitespace-nowrap">{formatDateTime(exec.created_at)}</td>
                                                <td>{renderExecutionType(exec.type)}</td>
                                                <td>
                                                    <div class="font-medium">{exec.resource_name}</div>
                                                    {exec.resource_type && <div class="text-[10px] text-base-content/60">{exec.resource_type}</div>}
                                                </td>
                                                <td>{exec.server_name}</td>
                                                <td>
                                                    <span class={`badge badge-sm ${exec.status === 'failed' ? 'badge-error' : 'badge-neutral'}`}>
                                                        {exec.status}
                                                    </span>
                                                </td>
                                                <td class="max-w-xs truncate text-xs" title={exec.message || ''}>
                                                    {exec.message || '-'}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            case 'skips':
                if (!data) return null;
                return (
                    <div class="grid gap-2.5 sm:gap-3 md:gap-4">
                        <div class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
                            <div class="overflow-x-auto">
                                <table class="table table-sm">
                                    <thead>
                                        <tr class="bg-base-200/50">
                                            <th>Date</th>
                                            <th>Type</th>
                                            <th>Ressource</th>
                                            <th>Raison de l'annulation</th>
                                            <th>Lien</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.skips.logs.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} class="py-8 text-center text-base-content/50">
                                                    Aucune tâche ignorée pour cette période.
                                                </td>
                                            </tr>
                                        ) : (
                                            data.skips.logs.map((skip: any, i: number) => (
                                                <tr key={i}>
                                                    <td class="whitespace-nowrap">{formatDateTime(skip.timestamp)}</td>
                                                    <td>{renderExecutionType(skip.type)}</td>
                                                    <td>{skip.resource_name || 'Inconnue'}</td>
                                                    <td class="text-xs">{skip.reason}</td>
                                                    <td>
                                                        {skip.link ? (
                                                            <a href={skip.link} class="btn btn-ghost btn-xs">Voir</a>
                                                        ) : '-'}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="text-sm text-base-content/60">
                                Total : {data.skips.totalCount} (Page {data.skips.currentPage})
                            </span>
                            <div class="join">
                                <button 
                                    class="join-item btn btn-sm" 
                                    disabled={!data.skips.hasPrev}
                                    onClick={() => setSkipPage(s => Math.max(0, s - 20))}
                                >
                                    Précédent
                                </button>
                                <button 
                                    class="join-item btn btn-sm" 
                                    disabled={!data.skips.hasNext}
                                    onClick={() => setSkipPage(s => s + 20)}
                                >
                                    Suivant
                                </button>
                            </div>
                        </div>
                    </div>
                );
            case 'manager':
                if (!data) return null;
                return (
                    <div class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden">
                        <div class="overflow-x-auto">
                            <table class="table table-sm">
                                <thead>
                                    <tr class="bg-base-200/50">
                                        <th>Date</th>
                                        <th>Message</th>
                                        <th>Durée (ms)</th>
                                        <th>Lancées</th>
                                        <th>Ignorées</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.managerRuns.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} class="py-8 text-center text-base-content/50">
                                                Aucune exécution récente du gestionnaire.
                                            </td>
                                        </tr>
                                    ) : (
                                        data.managerRuns.map((run: any, i: number) => (
                                            <tr key={i}>
                                                <td class="whitespace-nowrap">{formatDateTime(run.timestamp)}</td>
                                                <td class="text-xs">{run.message}</td>
                                                <td class="font-mono text-xs">{run.duration_ms ?? '-'}</td>
                                                <td class="font-mono text-xs">{run.dispatched ?? '-'}</td>
                                                <td class="font-mono text-xs">{run.skipped ?? '-'}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
        }
    })();

    return (
        <div class="grid gap-3 sm:gap-4 md:gap-5">
            <div class="flex flex-wrap items-start justify-between gap-2.5 sm:gap-3 md:gap-4">
                <PageHeader
                    title="Tâches planifiées"
                    description="Historique des sauvegardes, nettoyages Docker et crons d'applications."
                />
                
                <div class="flex items-center gap-2">
                    <select 
                        class="select select-bordered select-sm w-full max-w-xs"
                        value={filterDate}
                        onChange={(e) => setFilterDate(e.currentTarget.value)}
                    >
                        <option value="last_24h">Dernières 24h</option>
                        <option value="last_7d">Derniers 7 jours</option>
                        <option value="last_30d">Derniers 30 jours</option>
                    </select>
                    
                    <select 
                        class="select select-bordered select-sm w-full max-w-xs"
                        value={filterType}
                        onChange={(e) => setFilterType(e.currentTarget.value)}
                    >
                        <option value="all">Tous les types</option>
                        <option value="task">Crons d'applications</option>
                        <option value="backup">Sauvegardes</option>
                        <option value="cleanup">Nettoyages Docker</option>
                    </select>

                    <button 
                        class="btn btn-outline btn-sm"
                        onClick={() => dataQuery.reload()}
                    >
                        <RefreshCw class={`size-3.5 ${dataQuery.loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            <div class="tabs-boxed tabs mb-4 w-fit">
                <button
                    class={`tab gap-2 ${activeTab === 'definitions' ? 'tab-active' : ''}`}
                    onClick={() => setActiveTab('definitions')}
                >
                    <Settings class="size-4" />
                    Configurations
                </button>
                <button
                    class={`tab gap-2 ${activeTab === 'executions' ? 'tab-active' : ''}`}
                    onClick={() => setActiveTab('executions')}
                >
                    <AlertCircle class="size-4" />
                    Échecs d'exécution
                </button>
                <button
                    class={`tab gap-2 ${activeTab === 'skips' ? 'tab-active' : ''}`}
                    onClick={() => setActiveTab('skips')}
                >
                    <CalendarClock class="size-4" />
                    Tâches ignorées
                </button>
                <button
                    class={`tab gap-2 ${activeTab === 'manager' ? 'tab-active' : ''}`}
                    onClick={() => setActiveTab('manager')}
                >
                    <PlayCircle class="size-4" />
                    Moteur (Manager)
                </button>
            </div>

            <DataState loading={dataQuery.loading && !data} error={dataQuery.error} onRetry={() => void dataQuery.reload()}>
                {tabContent}
            </DataState>
        </div>
    );
}
