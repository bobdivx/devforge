import { Download, RefreshCw, Store } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import { PageHeader } from '../../components/PageHeader';
import { InstallFromStoreModal } from '../../components/store/InstallFromStoreModal';
import { Card } from '../../components/ui/Card';
import { DataState } from '../../components/ui/DataState';
import { FilterBar } from '../../components/ui/FilterBar';
import { domainApi, type StoreListing } from '../../lib/domain-api';
import { applicationPath } from '../../lib/application-tabs';
import { extractStoreSlug, storePath } from '../../lib/routes';
import { STORE_CATEGORIES, storeCategoryLabel } from '../../lib/store-categories';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo } from '../../lib/use-navigate';

type Props = {
    path: string;
};

function ListingCard({ listing, onOpen }: { listing: StoreListing; onOpen: () => void }) {
    return (
        <button
            class="min-w-0 rounded-2xl border border-base-300/70 bg-base-100 p-5 text-start shadow-sm transition hover:border-primary/40 hover:shadow-md"
            type="button"
            onClick={onOpen}
        >
            <div class="flex items-start gap-3">
                <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">
                    {listing.icon_url ? (
                        <img src={listing.icon_url} alt="" class="size-11 rounded-xl object-cover" />
                    ) : (
                        listing.name.slice(0, 1).toUpperCase()
                    )}
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                        <h2 class="truncate text-base font-semibold">{listing.name}</h2>
                        {listing.status !== 'published' && (
                            <span class="badge badge-ghost badge-sm">Brouillon</span>
                        )}
                    </div>
                    <p class="mt-1 line-clamp-2 text-sm text-base-content/60">
                        {listing.description || 'Aucune description.'}
                    </p>
                    <p class="mt-3 text-xs text-base-content/45">
                        {storeCategoryLabel(listing.category)} · {listing.install_count} install.{' '}
                        · {listing.publisher.team_name ?? 'DevForge'}
                    </p>
                </div>
            </div>
        </button>
    );
}

export function StorePage({ path }: Props) {
    const slug = extractStoreSlug(path);
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('');
    const [installOpen, setInstallOpen] = useState(false);

    const listQuery = useApiQuery(
        slug ? null : `store-listings:${query}:${category}`,
        () => domainApi.storeListings({
            q: query.trim() || undefined,
            category: category || undefined,
        }),
    );
    const detailQuery = useApiQuery(
        slug ? `store-listing:${slug}` : null,
        () => domainApi.storeListing(slug ?? ''),
    );

    const listings = listQuery.data?.data ?? [];
    const listing = detailQuery.data?.data ?? null;

    const filtered = useMemo(() => listings, [listings]);

    if (slug) {
        return (
            <>
                <PageHeader
                    eyebrow="Store"
                    title={listing?.name ?? 'Fiche'}
                    description={listing?.description ?? 'Installer cette application sur votre équipe DevForge.'}
                    actions={(
                        <>
                            <button class="btn btn-ghost btn-sm" type="button" onClick={() => navigateTo(storePath())}>
                                Catalogue
                            </button>
                            {listing && (
                                <button class="btn btn-primary btn-sm" type="button" onClick={() => setInstallOpen(true)}>
                                    <Download class="size-3.5" aria-hidden />
                                    Installer
                                </button>
                            )}
                        </>
                    )}
                />
                <DataState
                    loading={detailQuery.loading}
                    error={detailQuery.error}
                    empty={!listing}
                    emptyMessage="Cette fiche n’existe pas ou n’est plus publiée."
                    onRetry={() => void detailQuery.reload()}
                >
                    {listing && (
                        <div class="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
                            <Card title="À propos">
                                <dl class="grid gap-3 text-sm">
                                    <div>
                                        <dt class="text-xs uppercase tracking-wide text-base-content/45">Dépôt</dt>
                                        <dd class="font-mono">{listing.git_repository}@{listing.git_branch}</dd>
                                    </div>
                                    <div>
                                        <dt class="text-xs uppercase tracking-wide text-base-content/45">Catégorie</dt>
                                        <dd>{storeCategoryLabel(listing.category)}</dd>
                                    </div>
                                    <div>
                                        <dt class="text-xs uppercase tracking-wide text-base-content/45">Éditeur</dt>
                                        <dd>{listing.publisher.team_name ?? 'DevForge'}</dd>
                                    </div>
                                </dl>
                            </Card>
                            <Card title="Paramètres par défaut">
                                <dl class="grid gap-2 text-sm">
                                    <div class="flex justify-between gap-3">
                                        <dt class="text-base-content/50">Build pack</dt>
                                        <dd class="font-mono">{listing.runtime_defaults.build_pack ?? '—'}</dd>
                                    </div>
                                    <div class="flex justify-between gap-3">
                                        <dt class="text-base-content/50">Ports</dt>
                                        <dd class="font-mono">{listing.runtime_defaults.ports_exposes ?? '—'}</dd>
                                    </div>
                                    <div class="flex justify-between gap-3">
                                        <dt class="text-base-content/50">Start</dt>
                                        <dd class="truncate font-mono">{listing.runtime_defaults.start_command ?? 'auto'}</dd>
                                    </div>
                                </dl>
                            </Card>
                            <Card class="lg:col-span-2" title="Variables">
                                {listing.env_schema.length === 0 ? (
                                    <p class="text-sm text-base-content/55">Aucune variable à renseigner.</p>
                                ) : (
                                    <ul class="grid gap-2">
                                        {listing.env_schema.map((item) => (
                                            <li class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-base-300/60 px-3 py-2 text-sm" key={item.key}>
                                                <span class="font-mono text-xs">{item.key}</span>
                                                <span class="text-xs text-base-content/50">
                                                    {item.is_secret ? 'Secret' : item.has_default ? `Défaut : ${item.default}` : 'Optionnel'}
                                                    {item.required ? ' · obligatoire' : ''}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </Card>
                        </div>
                    )}
                </DataState>
                <InstallFromStoreModal
                    open={installOpen}
                    listing={listing}
                    onClose={() => setInstallOpen(false)}
                    onInstalled={(applicationUuid) => navigateTo(applicationPath(applicationUuid))}
                />
            </>
        );
    }

    return (
        <>
            <PageHeader
                eyebrow="Applications"
                title="Store"
                description="Installez une application fonctionnelle en un clic, avec les variables et paramètres déjà préparés par l’éditeur."
                actions={(
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void listQuery.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                )}
            />
            <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <FilterBar query={query} placeholder="Rechercher une app…" onQueryChange={setQuery} />
                <select class="select select-bordered select-sm w-full sm:w-48" value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
                    <option value="">Toutes les catégories</option>
                    {STORE_CATEGORIES.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                </select>
            </div>
            <DataState
                loading={listQuery.loading}
                error={listQuery.error}
                empty={filtered.length === 0}
                emptyMessage="Aucune application publiée pour le moment. Publiez une app en cours d’exécution depuis sa fiche."
                onRetry={() => void listQuery.reload()}
            >
                <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((item) => (
                        <ListingCard
                            key={item.uuid}
                            listing={item}
                            onOpen={() => navigateTo(storePath(item.slug))}
                        />
                    ))}
                </div>
            </DataState>
            {filtered.length === 0 && !listQuery.loading && !listQuery.error && (
                <Card>
                    <div class="flex items-start gap-3 text-sm text-base-content/65">
                        <Store class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                        <p>
                            Une application <strong>en cours d’exécution</strong> peut être publiée depuis sa page : choisissez les variables à oublier, les valeurs par défaut, puis installez-la ici.
                        </p>
                    </div>
                </Card>
            )}
        </>
    );
}
