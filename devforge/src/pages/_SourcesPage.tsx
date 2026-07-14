import { ExternalLink, RefreshCw } from 'lucide-preact';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { DataState } from '../components/ui/DataState';
import { LegacyEditBanner } from '../components/settings/SettingsPanels';
import { domainApi } from '../lib/domain-api';
import { legacyCoolifyUrl } from '../lib/migration';
import { useApiQuery } from '../lib/use-api-query';

type SourcesPageProps = {
    legacyBaseUrl?: string;
    githubAppUuid?: string | null;
};

export function SourcesPage({ legacyBaseUrl = '', githubAppUuid = null }: SourcesPageProps) {
    const apps = useApiQuery('github-apps', () => domainApi.githubApps());

    return (
        <div class="grid gap-5">
            <PageHeader
                title="Sources"
                description="Applications GitHub connectées à l’équipe active."
            />
            <LegacyEditBanner
                legacyBaseUrl={legacyBaseUrl}
                legacyPath={githubAppUuid ? `/source/github/${githubAppUuid}` : '/sources'}
                description="Créez ou modifiez les sources GitHub depuis Coolify."
            />
            <Card title="Applications GitHub">
                <div class="card-toolbar mb-3">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void apps.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </div>
                <DataState loading={apps.loading} error={apps.error} empty={(apps.data?.data.length ?? 0) === 0} emptyMessage="Aucune application GitHub." onRetry={() => void apps.reload()}>
                    <div class="grid gap-2 md:grid-cols-2">
                        {(apps.data?.data ?? []).map((app) => (
                            <a
                                class={`rounded-2xl border p-4 shadow-sm transition hover:border-primary/30 hover:shadow-md ${
                                    githubAppUuid === app.uuid ? 'border-primary/40 ring-1 ring-primary/15' : 'border-base-300/70'
                                }`}
                                href={legacyCoolifyUrl(legacyBaseUrl, `/source/github/${app.uuid}`)}
                                key={app.uuid}
                                rel="noreferrer"
                                target="_blank"
                            >
                                <div class="flex items-start justify-between gap-2">
                                    <div class="min-w-0">
                                        <p class="truncate text-sm font-semibold">{app.name}</p>
                                        <p class="truncate text-xs text-base-content/55">{app.organization ?? 'Organisation non définie'}</p>
                                    </div>
                                    <ExternalLink class="size-4 shrink-0 text-base-content/40" aria-hidden />
                                </div>
                            </a>
                        ))}
                    </div>
                </DataState>
            </Card>
        </div>
    );
}
