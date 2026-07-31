import { useEffect, useMemo, useState } from 'preact/hooks';
import { Modal } from '../ui/Modal';
import {
    domainApi,
    type CoreResource,
    type GithubAppSummary,
    type GithubRepository,
    type GithubRunnerCreateInput,
} from '../../lib/domain-api';

type Props = {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
};

type FormState = {
    github_app_uuid: string;
    repository_id: number | '';
    server_uuid: string;
    runner_name: string;
    labels: string;
    image: string;
};

const defaultForm = (): FormState => ({
    github_app_uuid: '',
    repository_id: '',
    server_uuid: '',
    runner_name: '',
    labels: 'self-hosted,devforge',
    image: 'myoung34/github-runner:latest',
});

export function CreateRunnerModal({ open, onClose, onCreated }: Props) {
    const [form, setForm] = useState<FormState>(defaultForm);
    const [githubApps, setGithubApps] = useState<GithubAppSummary[]>([]);
    const [repositories, setRepositories] = useState<GithubRepository[]>([]);
    const [servers, setServers] = useState<CoreResource[]>([]);
    const [repoSearch, setRepoSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }

        setForm(defaultForm());
        setRepoSearch('');
        setError(null);
        setLoading(true);

        void Promise.all([
            domainApi.githubApps(),
            domainApi.coreResources('servers'),
        ])
            .then(([appsResponse, serversResponse]) => {
                const apps = appsResponse.data ?? [];
                const serverList = serversResponse.data ?? [];
                setGithubApps(apps);
                setServers(serverList);
                setForm((current) => ({
                    ...current,
                    github_app_uuid: apps[0]?.uuid ?? '',
                    server_uuid: serverList[0]?.uuid ?? '',
                }));
            })
            .catch((err) => {
                setError(err instanceof Error ? err.message : 'Chargement impossible.');
            })
            .finally(() => setLoading(false));
    }, [open]);

    useEffect(() => {
        if (!open || !form.github_app_uuid) {
            setRepositories([]);
            return;
        }

        let cancelled = false;
        setLoading(true);
        void domainApi.githubRepositories(form.github_app_uuid)
            .then((response) => {
                if (cancelled) {
                    return;
                }
                setRepositories(response.data ?? []);
                setForm((current) => ({ ...current, repository_id: '' }));
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Impossible de charger les dépôts.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [open, form.github_app_uuid]);

    const filteredRepos = useMemo(() => {
        const normalized = repoSearch.trim().toLowerCase();
        if (!normalized) {
            return repositories;
        }

        return repositories.filter((repository) => repository.full_name.toLowerCase().includes(normalized)
            || repository.name.toLowerCase().includes(normalized));
    }, [repositories, repoSearch]);

    const selectedRepo = useMemo(
        () => repositories.find((repository) => repository.id === form.repository_id) ?? null,
        [repositories, form.repository_id],
    );

    useEffect(() => {
        if (!selectedRepo) {
            return;
        }

        setForm((current) => {
            if (current.runner_name.trim() !== '') {
                return current;
            }

            return {
                ...current,
                runner_name: `devforge-runner-${selectedRepo.name}`.slice(0, 64),
            };
        });
    }, [selectedRepo?.id]);

    const canSubmit = Boolean(
        form.github_app_uuid
        && selectedRepo
        && form.server_uuid
        && form.runner_name.trim()
        && !submitting
        && !loading,
    );

    async function handleSubmit(event: Event) {
        event.preventDefault();
        if (!selectedRepo || !canSubmit) {
            return;
        }

        setSubmitting(true);
        setError(null);

        const payload: GithubRunnerCreateInput = {
            github_app_uuid: form.github_app_uuid,
            owner: selectedRepo.owner,
            repo: selectedRepo.name,
            server_uuid: form.server_uuid,
            runner_name: form.runner_name.trim(),
            labels: form.labels.trim() || undefined,
            image: form.image.trim() || undefined,
        };

        try {
            await domainApi.createGithubRunner(payload);
            onCreated();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Création impossible.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Modal
            open={open}
            title="Nouveau runner GitHub"
            onClose={onClose}
            footer={(
                <>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>Annuler</button>
                    <button class="btn btn-primary btn-sm" type="submit" form="create-runner-form" disabled={!canSubmit}>
                        {submitting && <span class="loading loading-spinner loading-xs" />}
                        Créer le runner
                    </button>
                </>
            )}
        >
            <form id="create-runner-form" class="grid gap-4" onSubmit={handleSubmit}>
                <p class="text-xs text-base-content/60">
                    Déploie un conteneur <code class="text-[11px]">myoung34/github-runner</code> sur un serveur DevForge
                    avec un jeton d’enregistrement GitHub (sans PAT longue durée dans le conteneur).
                </p>

                {error && (
                    <p class="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
                )}

                {githubApps.length === 0 ? (
                    <p class="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                        Connectez une GitHub App dans Tokens & Clés API pour créer un runner.
                    </p>
                ) : (
                    <>
                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="runner-github-app">GitHub App</label>
                            <select
                                id="runner-github-app"
                                class="select select-bordered select-sm w-full"
                                value={form.github_app_uuid}
                                onChange={(event) => setForm((current) => ({
                                    ...current,
                                    github_app_uuid: (event.target as HTMLSelectElement).value,
                                }))}
                            >
                                {githubApps.map((app) => (
                                    <option key={app.uuid} value={app.uuid}>
                                        {app.display_name ?? app.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="runner-repo-search">Dépôt</label>
                            <input
                                id="runner-repo-search"
                                class="input input-bordered input-sm w-full"
                                placeholder="Rechercher un dépôt…"
                                value={repoSearch}
                                onInput={(event) => setRepoSearch((event.target as HTMLInputElement).value)}
                            />
                            <select
                                class="select select-bordered select-sm w-full"
                                value={form.repository_id}
                                onChange={(event) => setForm((current) => ({
                                    ...current,
                                    repository_id: Number((event.target as HTMLSelectElement).value) || '',
                                    runner_name: '',
                                }))}
                            >
                                <option value="">Choisir un dépôt</option>
                                {filteredRepos.map((repository) => (
                                    <option key={repository.id} value={repository.id}>{repository.full_name}</option>
                                ))}
                            </select>
                        </div>

                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="runner-server">Serveur</label>
                            <select
                                id="runner-server"
                                class="select select-bordered select-sm w-full"
                                value={form.server_uuid}
                                onChange={(event) => setForm((current) => ({
                                    ...current,
                                    server_uuid: (event.target as HTMLSelectElement).value,
                                }))}
                            >
                                {servers.map((server) => (
                                    <option key={server.uuid} value={server.uuid}>{server.name}</option>
                                ))}
                            </select>
                        </div>

                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="runner-name">Nom du runner</label>
                            <input
                                id="runner-name"
                                class="input input-bordered input-sm w-full font-mono"
                                value={form.runner_name}
                                onInput={(event) => setForm((current) => ({
                                    ...current,
                                    runner_name: (event.target as HTMLInputElement).value,
                                }))}
                            />
                        </div>

                        <div class="grid gap-3 sm:grid-cols-2">
                            <div class="grid gap-1.5">
                                <label class="text-xs font-medium" for="runner-labels">Labels</label>
                                <input
                                    id="runner-labels"
                                    class="input input-bordered input-sm w-full"
                                    value={form.labels}
                                    onInput={(event) => setForm((current) => ({
                                        ...current,
                                        labels: (event.target as HTMLInputElement).value,
                                    }))}
                                />
                            </div>
                            <div class="grid gap-1.5">
                                <label class="text-xs font-medium" for="runner-image">Image Docker</label>
                                <input
                                    id="runner-image"
                                    class="input input-bordered input-sm w-full font-mono text-[11px]"
                                    value={form.image}
                                    onInput={(event) => setForm((current) => ({
                                        ...current,
                                        image: (event.target as HTMLInputElement).value,
                                    }))}
                                />
                            </div>
                        </div>
                    </>
                )}
            </form>
        </Modal>
    );
}
