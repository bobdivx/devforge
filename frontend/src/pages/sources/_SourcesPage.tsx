import { ExternalLink, KeyRound, Trash2, Pencil, Bot } from 'lucide-preact';
import { useState, useMemo } from 'preact/hooks';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/ui/Card';
import { ConnectGithubButton, FinishGithubInstallButton } from '../../components/github/ConnectGithubButton';
import { isGithubAppInstalled } from '../../lib/onboarding-github';
import { SharedVariablesPanel } from '../../components/shared-variables/SharedVariablesPanel';
import { DevForgeMcpTokenCard } from '../../components/sources/DevForgeMcpTokenCard';
import type { BootstrapPermissions } from '../../lib/bootstrap';
import { domainApi, type GithubAppSummary } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { applicationPath } from '../../lib/routing/routes';

type ConnexionsPageProps = {
    legacyBaseUrl?: string;
    githubAppUuid?: string | null;
    permissions?: BootstrapPermissions;
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

export function ConnexionsPage({ permissions }: ConnexionsPageProps) {
    const apps = useApiQuery('github-apps', () => domainApi.githubApps());
    const agentRequests = useApiQuery('agent-key-requests', () => domainApi.agentKeyRequests());

    const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
    const [requestDrafts, setRequestDrafts] = useState<Record<string, string>>({});
    const [savingUuid, setSavingUuid] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editingGithubApp, setEditingGithubApp] = useState<GithubAppSummary | null>(null);

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
            if (!clear) setEditingGithubApp(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Enregistrement impossible.');
        } finally {
            setSavingUuid(null);
        }
    }

    async function fulfillAgentRequest(uuid: string) {
        const value = (requestDrafts[uuid] ?? '').trim();
        if (!value) return;

        setSavingUuid(uuid);
        setFeedback(null);
        setError(null);
        try {
            const result = await domainApi.fulfillAgentKeyRequest(uuid, value);
            setFeedback(result.message);
            setRequestDrafts((current) => ({ ...current, [uuid]: '' }));
            await agentRequests.reload();
            // Also reload the shared variables since we just added one
            window.dispatchEvent(new CustomEvent('devforge-reload-shared-variables'));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Enregistrement impossible.');
        } finally {
            setSavingUuid(null);
        }
    }

    const listedApps = apps.data?.data ?? [];
    const installedApps = listedApps.filter(isGithubAppInstalled);
    const pendingApps = listedApps.filter((app) => !isGithubAppInstalled(app));

    const extraVariables = useMemo(() => {
        return installedApps.map((app) => ({
            id: -Math.floor(Math.random() * 1000000),
            key: `github_pat_${app.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
            value: app.has_packages_token ? '***' : '',
            comment: `Token Packages optionnel · ${accountSubtitle(app)}`,
            scope: 'team',
            is_multiline: false,
            is_literal: true,
            is_shown_once: false,
            isExtra: true,
            originalApp: app,
        } as any));
    }, [installedApps]);

    return (
        <div class="grid gap-3 sm:gap-4 md:gap-5">
            <PageHeader
                title="Connexions & Intégrations"
                description="Hub central pour GitHub, tokens API, clés d'agents, MCP et tous vos services connectés."
            />
            {(feedback || error) && (
                <p class={`text-sm ${error ? 'text-error' : 'text-success'}`}>{error ?? feedback}</p>
            )}

            {pendingApps.length > 0 && (
                <Card title="Compte GitHub" eyebrow="Installation incomplète">
                    <p class="mb-3 text-sm text-base-content/65">
                        L’app {pendingApps[0].display_name ?? pendingApps[0].name} est créée sur GitHub, mais pas encore
                        installée sur votre compte. Le token Packages vide n’est pas requis pour ajouter une application.
                    </p>
                    <FinishGithubInstallButton
                        app={pendingApps[0]}
                        returnTo="applications"
                        onError={setError}
                    />
                </Card>
            )}
            {installedApps.length === 0 && pendingApps.length === 0 && (
                <Card title="Compte GitHub" eyebrow="Requis pour déployer">
                    <p class="mb-3 text-sm text-base-content/65">
                        Aucune GitHub App n’est encore reliée. Relancez la configuration pour autoriser DevForge à lire vos dépôts.
                    </p>
                    <ConnectGithubButton
                        returnTo="applications"
                        label="Relancer la configuration GitHub"
                        onError={setError}
                    />
                </Card>
            )}

            {agentRequests.data?.data && agentRequests.data.data.length > 0 && (
                <Card title="Demandes d'agents" eyebrow="Action Requise" class="border-warning bg-warning/5">
                    <p class="mb-4 text-xs text-base-content/70">
                        Certains agents IA sont en pause car ils ont besoin de variables ou clés API pour continuer leur travail.
                    </p>
                    <div class="grid gap-2.5 sm:gap-3 md:gap-4">
                        {agentRequests.data.data.map((req) => (
                            <div key={req.uuid} class="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-100 p-4">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <Bot class="size-3.5 sm:size-4 text-primary" aria-hidden />
                                    <span class="font-semibold">{req.agent?.name ?? 'Agent'}</span>
                                    <span class="text-xs text-base-content/60">a besoin de</span>
                                    <code class="font-mono text-sm">{req.key_name}</code>
                                </div>
                                {req.application_name && (
                                    <div class="flex items-center gap-2 text-xs text-base-content/70">
                                        <span>Pour l'application :</span>
                                        <a 
                                            href={applicationPath(req.application_uuid ?? '')}
                                            class="font-medium hover:text-primary underline"
                                        >
                                            {req.application_name}
                                        </a>
                                    </div>
                                )}
                                {req.reason && <p class="text-xs text-base-content/70">{req.reason}</p>}
                                <form 
                                    class="mt-2 flex gap-2" 
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        void fulfillAgentRequest(req.uuid);
                                    }}
                                >
                                    <input
                                        class="input input-sm input-bordered flex-1 font-mono"
                                        type="password"
                                        placeholder={`Valeur pour ${req.key_name}`}
                                        value={requestDrafts[req.uuid] ?? ''}
                                        onInput={(e) => setRequestDrafts(cur => ({ ...cur, [req.uuid]: (e.target as HTMLInputElement).value }))}
                                    />
                                    <button
                                        class="btn btn-primary btn-sm"
                                        type="submit"
                                        disabled={savingUuid === req.uuid || !(requestDrafts[req.uuid]?.trim())}
                                    >
                                        <KeyRound class="size-3.5" aria-hidden />
                                        Fournir
                                    </button>
                                </form>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <Card title="Clés API d'Équipe" eyebrow="Agents & Scripts">
                <p class="mb-4 text-xs text-base-content/55">
                    Variables et clés d'API (OpenAI, Stripe, etc.) accessibles par tous vos agents IA et partagées au sein de l'équipe.
                </p>
                <div class="-m-1">
                    <SharedVariablesPanel
                        path="team"
                        forceScope="team"
                        embedded={true}
                        canManage={permissions?.manage_team ?? false}
                        extraVariables={extraVariables}
                        renderExtraActions={(variable: any) => (
                            <div class="action-toolbar">
                                {variable.originalApp.account_html_url && (
                                    <a class="btn btn-ghost btn-xs" href={variable.originalApp.account_html_url} target="_blank" rel="noreferrer" title="Ouvrir le profil GitHub" aria-label="Ouvrir profil GitHub">
                                        <ExternalLink class="size-3.5" aria-hidden />
                                    </a>
                                )}
                                {variable.originalApp.html_url && (
                                    <a class="btn btn-ghost btn-xs" href={variable.originalApp.html_url} target="_blank" rel="noreferrer" title="Ouvrir l'App GitHub" aria-label="Ouvrir l'App GitHub">
                                        <ExternalLink class="size-3.5" aria-hidden />
                                    </a>
                                )}
                                <button class="btn btn-ghost btn-xs" type="button" aria-label="Modifier le PAT GitHub" onClick={() => {
                                    setEditingGithubApp(variable.originalApp);
                                    setTokenDrafts((current) => ({ ...current, [variable.originalApp.uuid]: '' }));
                                }}>
                                    <Pencil class="size-3.5" aria-hidden />
                                </button>
                                <button class="btn btn-ghost btn-xs text-error" type="button" disabled={!variable.originalApp.has_packages_token} aria-label="Effacer le PAT GitHub" onClick={() => void savePackagesToken(variable.originalApp, true)}>
                                    <Trash2 class="size-3.5" aria-hidden />
                                </button>
                            </div>
                        )}
                    />
                </div>
            </Card>

            <DevForgeMcpTokenCard />

            <Modal title="Token GitHub (Packages)" open={!!editingGithubApp} onClose={() => setEditingGithubApp(null)}>
                <form 
                    class="p-6"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (editingGithubApp) void savePackagesToken(editingGithubApp);
                    }}
                >
                    <h3 class="text-lg font-bold">Token GitHub (Packages)</h3>
                    <p class="mt-2 text-sm text-base-content/70">
                        Saisissez le Personal Access Token (PAT) avec la permission <code class="font-mono text-xs">read:packages</code> pour le compte {editingGithubApp ? accountLabel(editingGithubApp) : ''}.
                    </p>
                    <div class="mt-4">
                        <input
                            class="input input-bordered w-full font-mono text-sm"
                            type="password"
                            autocomplete="off"
                            placeholder="ghp_… (PAT read:packages)"
                            value={editingGithubApp ? (tokenDrafts[editingGithubApp.uuid] ?? '') : ''}
                            onInput={(event) => {
                                if (!editingGithubApp) return;
                                const value = (event.target as HTMLInputElement).value;
                                setTokenDrafts((current) => ({ ...current, [editingGithubApp.uuid]: value }));
                            }}
                        />
                    </div>
                    <div class="modal-action mt-6">
                        <button class="btn btn-ghost" type="button" onClick={() => setEditingGithubApp(null)}>Annuler</button>
                        <button
                            class="btn btn-primary"
                            type="submit"
                            disabled={!editingGithubApp || savingUuid === editingGithubApp?.uuid}
                        >
                            <KeyRound class="size-3.5" aria-hidden />
                            Enregistrer
                        </button>
                    </div>
                </form>
            </Modal>


        </div>
    );
}

/** @deprecated Prefer ConnexionsPage — alias pour compatibilité imports. */
export const GithubPage = ConnexionsPage;
/** @deprecated Prefer ConnexionsPage — alias pour compatibilité imports. */
export const SourcesPage = ConnexionsPage;
