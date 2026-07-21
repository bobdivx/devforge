import { ExternalLink, KeyRound, Package, RefreshCw, Trash2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/ui/Card';
import { DataState } from '../../components/ui/DataState';
import { LegacyEditBanner } from '../../components/migration/LegacyEditBanner';
import { domainApi, type GithubAppSummary } from '../../lib/domain-api';
import { legacyCoolifyUrl } from '../../lib/migration';
import { useApiQuery } from '../../lib/use-api-query';

type ConnexionsPageProps = {
    legacyBaseUrl?: string;
    githubAppUuid?: string | null;
};

function accountLabel(app: GithubAppSummary): string {
    if (app.account_login) {
        return `@${app.account_login}`;
    }

    if (app.display_name) {
        return app.display_name;
    }

    return app.name;
}

function accountSubtitle(app: GithubAppSummary): string {
    const parts: string[] = [];
    if (app.account_type === 'Organization') {
        parts.push('Organisation GitHub');
    } else if (app.account_type === 'User') {
        parts.push('Compte GitHub');
    }
    parts.push(`App technique · ${app.name}`);
    return parts.join(' · ');
}

export function ConnexionsPage({ legacyBaseUrl = '', githubAppUuid = null }: ConnexionsPageProps) {
    const apps = useApiQuery('github-apps', () => domainApi.githubApps());
    const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
    const [savingUuid, setSavingUuid] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function savePackagesToken(app: GithubAppSummary, clear = false) {
        setSavingUuid(app.uuid);
        setFeedback(null);
        setError(null);
        try {
            const token = clear ? null : (tokenDrafts[app.uuid] ?? '').trim();
            if (!clear && !token) {
                setError('Colle un PAT GitHub (read:packages) avant d’enregistrer.');
                return;
            }
            const result = await domainApi.updateGithubPackagesToken(app.uuid, token);
            setFeedback(result.message ?? (clear ? 'Token supprimé.' : 'Token enregistré.'));
            setTokenDrafts((current) => ({ ...current, [app.uuid]: '' }));
            await apps.reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Enregistrement impossible.');
        } finally {
            setSavingUuid(null);
        }
    }

    return (
        <div class="grid gap-5">
            <PageHeader
                title="Connexions"
                description="Comptes liés, tokens et clés API utilisés au build et au déploiement (GitHub Packages, npm, etc.)."
            />
            <LegacyEditBanner
                legacyBaseUrl={legacyBaseUrl}
                legacyPath={githubAppUuid ? `/source/github/${githubAppUuid}` : '/sources'}
                description="Créer ou modifier une GitHub App reste dans Coolify (connexion OAuth / permissions)."
            />
            {(feedback || error) && (
                <p class={`text-sm ${error ? 'text-error' : 'text-success'}`}>{error ?? feedback}</p>
            )}

            <Card title="GitHub" eyebrow="Dépôts & Packages">
                <p class="mb-3 text-xs text-base-content/55">
                    Compte GitHub de l’équipe. Le token Packages (PAT <code class="font-mono">read:packages</code>)
                    est injecté au build comme <code class="font-mono">NODE_AUTH_TOKEN</code> pour
                    {' '}<code class="font-mono">npm.pkg.github.com</code>.
                </p>
                <div class="card-toolbar mb-3">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void apps.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </div>
                <DataState loading={apps.loading} error={apps.error} empty={(apps.data?.data.length ?? 0) === 0} emptyMessage="Aucun compte GitHub connecté." onRetry={() => void apps.reload()}>
                    <div class="grid gap-3">
                        {(apps.data?.data ?? []).map((app) => (
                            <div
                                class={`rounded-2xl border p-4 shadow-sm ${
                                    githubAppUuid === app.uuid ? 'border-primary/40 ring-1 ring-primary/15' : 'border-base-300/70'
                                }`}
                                key={app.uuid}
                            >
                                <div class="flex items-start justify-between gap-3">
                                    <div class="flex min-w-0 items-start gap-3">
                                        {app.account_avatar_url ? (
                                            <img
                                                src={app.account_avatar_url}
                                                alt=""
                                                class="size-10 shrink-0 rounded-full object-cover"
                                                width={40}
                                                height={40}
                                            />
                                        ) : (
                                            <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-base-200 text-sm font-semibold">
                                                {(accountLabel(app).replace('@', '').slice(0, 1) || 'G').toUpperCase()}
                                            </div>
                                        )}
                                        <div class="min-w-0">
                                            <p class="truncate text-sm font-semibold">{accountLabel(app)}</p>
                                            <p class="truncate text-xs text-base-content/55">{accountSubtitle(app)}</p>
                                            <p class="mt-1 text-xs text-base-content/60">
                                                Token Packages : {app.has_packages_token ? 'enregistré' : 'absent'}
                                            </p>
                                        </div>
                                    </div>
                                    <div class="flex shrink-0 gap-1">
                                        {app.account_html_url && (
                                            <a
                                                class="btn btn-ghost btn-sm"
                                                href={app.account_html_url}
                                                rel="noreferrer"
                                                target="_blank"
                                                title="Ouvrir le profil GitHub"
                                            >
                                                <ExternalLink class="size-4" aria-hidden />
                                            </a>
                                        )}
                                        <a
                                            class="btn btn-ghost btn-sm"
                                            href={legacyCoolifyUrl(legacyBaseUrl, `/source/github/${app.uuid}`)}
                                            rel="noreferrer"
                                            target="_blank"
                                            title="Configurer dans DevForge"
                                        >
                                            DevForge
                                        </a>
                                    </div>
                                </div>
                                <div class="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                                    <input
                                        class="input input-bordered input-sm w-full font-mono"
                                        type="password"
                                        autocomplete="off"
                                        placeholder="ghp_… (PAT read:packages)"
                                        value={tokenDrafts[app.uuid] ?? ''}
                                        onInput={(event) => {
                                            const value = (event.target as HTMLInputElement).value;
                                            setTokenDrafts((current) => ({ ...current, [app.uuid]: value }));
                                        }}
                                    />
                                    <button
                                        class="btn btn-primary btn-sm"
                                        type="button"
                                        disabled={savingUuid === app.uuid}
                                        onClick={() => void savePackagesToken(app)}
                                    >
                                        <KeyRound class="size-3.5" aria-hidden />
                                        Enregistrer
                                    </button>
                                    <button
                                        class="btn btn-ghost btn-sm"
                                        type="button"
                                        disabled={savingUuid === app.uuid || !app.has_packages_token}
                                        onClick={() => void savePackagesToken(app, true)}
                                    >
                                        <Trash2 class="size-3.5" aria-hidden />
                                        Effacer
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </DataState>
            </Card>

            <Card title="npm / registries privés" eyebrow="Build">
                <div class="flex items-start gap-3 text-sm text-base-content/70">
                    <Package class="mt-0.5 size-5 shrink-0 text-base-content/40" aria-hidden />
                    <div class="grid gap-2">
                        <p>
                            Pour GitHub Packages, utilise le token ci-dessus (recommandé) : Coolify injecte
                            {' '}<code class="font-mono text-xs">NODE_AUTH_TOKEN</code> au build.
                        </p>
                        <p>
                            Alternative par application : variable d’environnement de build
                            {' '}<code class="font-mono text-xs">NODE_AUTH_TOKEN</code> ou
                            {' '}<code class="font-mono text-xs">NPM_TOKEN</code> sur l’app concernée.
                        </p>
                        <ol class="mt-1 list-decimal space-y-1 pl-4 text-xs text-base-content/60">
                            <li>
                                Créer un PAT GitHub (classic) avec scope{' '}
                                <code class="font-mono">read:packages</code>.
                            </li>
                            <li>L’enregistrer dans la section GitHub de cette page.</li>
                            <li>Relancer le déploiement de l’application.</li>
                        </ol>
                    </div>
                </div>
            </Card>
        </div>
    );
}

/** @deprecated Prefer ConnexionsPage — alias pour compatibilité imports. */
export const GithubPage = ConnexionsPage;
/** @deprecated Prefer ConnexionsPage — alias pour compatibilité imports. */
export const SourcesPage = ConnexionsPage;
