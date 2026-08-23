import { ArrowLeft, ChevronRight, ExternalLink, FolderGit2, Plus, RefreshCw, Search } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { domainApi, type GithubAppSummary, type GithubRepository } from '../../lib/domain-api';
import {
    areAllVisibleSelected,
    attachGithubAppUuid,
    filterGithubOrganizations,
    findOrganizationByOwner,
    githubInstallationSettingsUrl,
    githubOrganizationsFromApps,
    setVisibleSelection,
    togglePickedRepository,
    type GithubOrganizationOption,
    type PickedGithubRepository,
} from '../../lib/github-repo-picker';
import { filterGithubRepositories } from '../../lib/onboarding-github';
import { redirectToGithubAppSetup } from './ConnectGithubButton';

export type GithubRepoPickerProps = {
    apps: GithubAppSummary[];
    mode: 'single' | 'multiple';
    selected: PickedGithubRepository[];
    onChange: (selected: PickedGithubRepository[]) => void;
    disabled?: boolean;
    canManage?: boolean;
    onRefreshApps?: () => void;
    returnTo?: 'applications' | 'onboarding';
    fromOnboarding?: boolean;
    initialOwner?: string;
    initialRepo?: string;
    onError?: (message: string) => void;
};

function OrganizationAvatar({ label, avatarUrl }: { label: string; avatarUrl: string | null }) {
    if (avatarUrl) {
        return (
            <img
                src={avatarUrl}
                alt=""
                class="size-8 shrink-0 rounded-full bg-warning/30 object-cover"
            />
        );
    }

    return (
        <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning text-xs sm:text-sm font-semibold text-warning-content">
            {label.slice(0, 1).toUpperCase()}
        </span>
    );
}

export function GithubRepoPicker({
    apps,
    mode,
    selected,
    onChange,
    disabled = false,
    canManage = true,
    onRefreshApps,
    returnTo,
    fromOnboarding = false,
    initialOwner,
    initialRepo,
    onError,
}: GithubRepoPickerProps) {
    const organizations = useMemo(() => githubOrganizationsFromApps(apps), [apps]);
    const [view, setView] = useState<'organizations' | 'repositories'>('organizations');
    const [selectedOrgKey, setSelectedOrgKey] = useState<string | null>(null);
    const [orgQuery, setOrgQuery] = useState('');
    const [repoQuery, setRepoQuery] = useState('');
    const [repositories, setRepositories] = useState<GithubRepository[]>([]);
    const [loadingRepos, setLoadingRepos] = useState(false);
    const [repoError, setRepoError] = useState<string | null>(null);
    const [addingOrg, setAddingOrg] = useState(false);
    const [refreshNonce, setRefreshNonce] = useState(0);

    const selectedOrganization = organizations.find((organization) => organization.key === selectedOrgKey) ?? null;
    const selectedApp = apps.find((app) => app.uuid === selectedOrganization?.githubAppUuid) ?? null;

    useEffect(() => {
        if (selectedOrgKey && organizations.some((organization) => organization.key === selectedOrgKey)) {
            return;
        }

        const preferred = findOrganizationByOwner(organizations, initialOwner);
        if (preferred) {
            setSelectedOrgKey(preferred.key);
            setView('repositories');
            return;
        }

        if (organizations.length === 1) {
            setSelectedOrgKey(organizations[0].key);
            setView('repositories');
        }
    }, [organizations, selectedOrgKey, initialOwner]);

    useEffect(() => {
        if (!selectedOrganization) {
            setRepositories([]);
            return;
        }

        let cancelled = false;
        setLoadingRepos(true);
        setRepoError(null);
        setRepositories([]);

        void domainApi.githubRepositories(selectedOrganization.githubAppUuid)
            .then((response) => {
                if (cancelled) {
                    return;
                }
                setRepositories(response.data);
            })
            .catch((loadError: unknown) => {
                if (!cancelled) {
                    setRepoError(loadError instanceof Error ? loadError.message : 'Impossible de charger les dépôts GitHub.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingRepos(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [selectedOrganization?.githubAppUuid, refreshNonce]);

    const visibleOrganizations = useMemo(
        () => filterGithubOrganizations(organizations, orgQuery),
        [organizations, orgQuery],
    );

    const organizationRepos = useMemo(
        () => (selectedOrganization
            ? attachGithubAppUuid(repositories, selectedOrganization.githubAppUuid)
            : []),
        [repositories, selectedOrganization],
    );
    const visibleRepos = useMemo(
        () => filterGithubRepositories(organizationRepos, repoQuery),
        [organizationRepos, repoQuery],
    );
    const allVisibleSelected = areAllVisibleSelected(selected, visibleRepos);

    useEffect(() => {
        if (mode !== 'single' || selected.length > 0 || !initialRepo) {
            return;
        }

        const normalized = initialRepo.trim().toLowerCase();
        const match = organizationRepos.find((repository) => repository.name.toLowerCase() === normalized);
        if (match) {
            onChange([match]);
        }
    }, [mode, selected.length, initialRepo, organizationRepos, onChange]);
    const addRepositoriesUrl = selectedApp ? githubInstallationSettingsUrl(selectedApp) : null;
    const selectedIds = new Set(selected.map((repository) => repository.id));
    const locked = disabled || !canManage;

    const openOrganization = (organization: GithubOrganizationOption) => {
        setSelectedOrgKey(organization.key);
        setRepoQuery('');
        setView('repositories');
    };

    const addOrganization = async () => {
        if (locked || addingOrg) {
            return;
        }

        setAddingOrg(true);
        try {
            await redirectToGithubAppSetup({
                fromOnboarding,
                returnTo: returnTo ?? (fromOnboarding ? 'onboarding' : 'applications'),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Impossible d’ouvrir GitHub pour ajouter une organisation.';
            onError?.(message);
            setAddingOrg(false);
        }
    };

    const refreshCurrent = () => {
        if (view === 'organizations') {
            onRefreshApps?.();
            return;
        }

        if (selectedOrganization) {
            setRefreshNonce((current) => current + 1);
        }
    };

    return (
        <div class="overflow-hidden rounded-2xl border border-base-300/70 bg-base-200/20">
            {view === 'repositories' && selectedOrganization ? (
                <div class="flex items-center gap-2 border-b border-base-300/60 px-3 py-2.5">
                    <button
                        class="btn btn-ghost btn-xs btn-square"
                        type="button"
                        aria-label="Retour aux organisations"
                        onClick={() => setView('organizations')}
                    >
                        <ArrowLeft class="size-4" aria-hidden />
                    </button>
                    <OrganizationAvatar label={selectedOrganization.label} avatarUrl={selectedOrganization.avatarUrl} />
                    <p class="min-w-0 truncate text-xs sm:text-sm font-semibold">{selectedOrganization.label}</p>
                </div>
            ) : null}

            <label class="m-3 flex items-center gap-2 rounded-xl border border-base-300/70 bg-base-100 px-3 py-2">
                <Search class="size-3.5 sm:size-4 text-base-content/40" aria-hidden />
                <input
                    class="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    type="search"
                    placeholder={view === 'organizations' ? 'Rechercher une organisation' : 'Rechercher un dépôt'}
                    value={view === 'organizations' ? orgQuery : repoQuery}
                    onInput={(event) => {
                        const value = event.currentTarget.value;
                        if (view === 'organizations') {
                            setOrgQuery(value);
                        } else {
                            setRepoQuery(value);
                        }
                    }}
                />
            </label>

            {view === 'organizations' ? (
                <>
                    <p class="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-base-content/45">
                        {visibleOrganizations.length} organisation{visibleOrganizations.length > 1 ? 's' : ''}
                    </p>
                    {visibleOrganizations.length === 0 ? (
                        <p class="px-3 py-6 text-center text-sm text-base-content/55">
                            Aucune organisation GitHub. Ajoutez un compte ou une organisation.
                        </p>
                    ) : (
                        <ul class="max-h-80 divide-y divide-base-300/60 overflow-y-auto">
                            {visibleOrganizations.map((organization) => {
                                const selectedCount = selected.filter((item) => item.github_app_uuid === organization.githubAppUuid).length;
                                return (
                                    <li key={organization.key}>
                                        <button
                                            class="flex w-full items-center gap-2 sm:gap-3 px-2.5 sm:px-3 py-2.5 sm:py-3 text-left transition hover:bg-base-200/80"
                                            type="button"
                                            onClick={() => openOrganization(organization)}
                                        >
                                            <OrganizationAvatar label={organization.label} avatarUrl={organization.avatarUrl} />
                                            <span class="min-w-0 flex-1">
                                                <span class="block truncate text-xs sm:text-sm font-semibold">{organization.label}</span>
                                                {organization.subtitle && (
                                                    <span class="block text-[11px] text-base-content/50">{organization.subtitle}</span>
                                                )}
                                            </span>
                                            {selectedCount > 0 && (
                                                <span class="badge badge-primary badge-sm">{selectedCount}</span>
                                            )}
                                            <ChevronRight class="size-3.5 sm:size-4 text-base-content/35" aria-hidden />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </>
            ) : (
                <>
                    <div class="flex items-center justify-between gap-2 px-3 pb-1">
                        <p class="text-[11px] font-medium uppercase tracking-wide text-base-content/45">
                            {loadingRepos ? 'Dépôts' : `${visibleRepos.length} dépôt${visibleRepos.length > 1 ? 's' : ''}`}
                        </p>
                        {mode === 'multiple' && visibleRepos.length > 0 && (
                            <button
                                class="text-xs font-medium text-primary hover:underline"
                                type="button"
                                disabled={locked}
                                onClick={() => onChange(setVisibleSelection(selected, visibleRepos, !allVisibleSelected))}
                            >
                                {allVisibleSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                            </button>
                        )}
                    </div>
                    {repoError && organizationRepos.length === 0 ? (
                        <p class="px-3 py-6 text-center text-sm text-error" role="alert">{repoError}</p>
                    ) : loadingRepos && organizationRepos.length === 0 ? (
                        <div class="flex items-center justify-center gap-2 py-8 text-xs text-base-content/55" role="status">
                            <span class="loading loading-spinner loading-xs text-primary" aria-hidden />
                            Chargement des dépôts…
                        </div>
                    ) : visibleRepos.length === 0 ? (
                        <p class="px-3 py-6 text-center text-sm text-base-content/55">
                            Aucun dépôt visible. Ajoutez des dépôts à l’installation GitHub, puis actualisez.
                        </p>
                    ) : (
                        <ul class="max-h-80 divide-y divide-base-300/60 overflow-y-auto">
                            {visibleRepos.map((repository) => {
                                const checked = selectedIds.has(repository.id);
                                return (
                                    <li key={repository.id}>
                                        {mode === 'multiple' ? (
                                            <label class="flex cursor-pointer items-center gap-2 sm:gap-3 px-3 py-2.5 hover:bg-base-200/80">
                                                <input
                                                    class="checkbox checkbox-sm"
                                                    type="checkbox"
                                                    checked={checked}
                                                    disabled={locked}
                                                    onChange={() => onChange(togglePickedRepository(selected, repository, mode))}
                                                />
                                                <FolderGit2 class="size-3.5 sm:size-4 shrink-0 text-base-content/40" aria-hidden />
                                                <span class="min-w-0">
                                                    <span class="block truncate text-xs sm:text-sm font-medium">{repository.name}</span>
                                                    {repository.description && (
                                                        <span class="block truncate text-[11px] text-base-content/50">{repository.description}</span>
                                                    )}
                                                </span>
                                            </label>
                                        ) : (
                                            <button
                                                class={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-base-200/80 ${
                                                    checked ? 'bg-primary/10' : ''
                                                }`}
                                                type="button"
                                                disabled={locked}
                                                onClick={() => onChange(togglePickedRepository(selected, repository, mode))}
                                            >
                                                <span class={`flex size-4 shrink-0 items-center justify-center rounded border ${
                                                    checked ? 'border-primary bg-primary' : 'border-base-content/30'
                                                }`}>
                                                    {checked && <span class="size-1.5 rounded-sm bg-primary-content" />}
                                                </span>
                                                <FolderGit2 class="size-3.5 sm:size-4 shrink-0 text-base-content/40" aria-hidden />
                                                <span class="min-w-0">
                                                    <span class="block truncate text-xs sm:text-sm font-medium">{repository.name}</span>
                                                    {repository.description && (
                                                        <span class="block truncate text-[11px] text-base-content/50">{repository.description}</span>
                                                    )}
                                                </span>
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </>
            )}

            <div class="flex items-center justify-between gap-2 border-t border-base-300/60 px-3 py-2">
                {view === 'organizations' ? (
                    <button
                        class="btn btn-ghost btn-xs gap-1"
                        type="button"
                        disabled={locked || addingOrg}
                        onClick={() => void addOrganization()}
                    >
                        <Plus class="size-3.5" aria-hidden />
                        {addingOrg ? 'Ouverture…' : 'Ajouter une organisation'}
                        <ExternalLink class="size-3 opacity-60" aria-hidden />
                    </button>
                ) : addRepositoriesUrl ? (
                    <a
                        class="btn btn-ghost btn-xs gap-1"
                        href={addRepositoriesUrl}
                        target="_blank"
                        rel="noreferrer"
                    >
                        <Plus class="size-3.5" aria-hidden />
                        Ajouter des dépôts
                        <ExternalLink class="size-3 opacity-60" aria-hidden />
                    </a>
                ) : (
                    <span />
                )}
                <button
                    class="btn btn-ghost btn-xs btn-square"
                    type="button"
                    aria-label="Actualiser"
                    onClick={refreshCurrent}
                >
                    <RefreshCw class="size-3.5" aria-hidden />
                </button>
            </div>
        </div>
    );
}
