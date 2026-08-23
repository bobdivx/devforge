import { Copy, ExternalLink, Save } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { domainApi, type ApplicationWebhooks } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type Props = {
    applicationUuid: string;
    canAct: boolean;
};

type SecretDraft = {
    manual_webhook_secret_github: string;
    manual_webhook_secret_gitlab: string;
    manual_webhook_secret_bitbucket: string;
    manual_webhook_secret_gitea: string;
};

const emptyDraft = (): SecretDraft => ({
    manual_webhook_secret_github: '',
    manual_webhook_secret_gitlab: '',
    manual_webhook_secret_bitbucket: '',
    manual_webhook_secret_gitea: '',
});

async function copyText(value: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch {
        return false;
    }
}

function UrlField({ label, value, helper }: { label: string; value: string | null; helper?: string }) {
    const [copied, setCopied] = useState(false);

    if (!value) {
        return null;
    }

    return (
        <label class="grid gap-1.5 text-sm">
            <span class="font-medium text-base-content/80">{label}</span>
            {helper && <span class="text-xs text-base-content/45">{helper}</span>}
            <div class="flex flex-col gap-2 sm:flex-row">
                <input class="input input-bordered w-full font-mono text-xs" readOnly value={value} />
                <button
                    class="btn btn-ghost btn-sm border border-base-300/80"
                    type="button"
                    onClick={() => {
                        void copyText(value).then((ok) => {
                            if (ok) {
                                setCopied(true);
                                window.setTimeout(() => setCopied(false), 1500);
                            }
                        });
                    }}
                >
                    <Copy class="size-3.5" aria-hidden />
                    {copied ? 'Copié' : 'Copier'}
                </button>
            </div>
        </label>
    );
}

export function ApplicationWebhooksPanel({ applicationUuid, canAct }: Props) {
    const query = useApiQuery(
        `application-webhooks:${applicationUuid}`,
        () => domainApi.applicationWebhooks(applicationUuid),
    );
    const data = query.data?.data as ApplicationWebhooks | undefined;
    const [draft, setDraft] = useState<SecretDraft>(emptyDraft);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        setDraft(emptyDraft());
        setError(null);
        setMessage(null);
    }, [applicationUuid, data?.manual_webhooks_available]);

    const save = async () => {
        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            const payload: Partial<SecretDraft> = {};
            (Object.keys(draft) as Array<keyof SecretDraft>).forEach((key) => {
                if (draft[key].trim() !== '') {
                    payload[key] = draft[key].trim();
                }
            });

            await domainApi.updateApplicationWebhooks(applicationUuid, payload);
            setDraft(emptyDraft());
            setMessage('Secrets webhook enregistrés.');
            await query.reload();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Échec de l’enregistrement des secrets.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-3 sm:px-3 sm:px-4 md:px-5 py-3 sm:py-3 sm:py-4">
                <div>
                    <p class="text-xs sm:text-sm font-semibold">Webhooks</p>
                    <p class="text-xs text-base-content/50">Déploiement API et webhooks Git manuels</p>
                </div>
                <ActionToolbar>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        Actualiser
                    </button>
                </ActionToolbar>
            </div>

            <div class="grid gap-3 sm:gap-2.5 sm:gap-3 md:gap-4 md:gap-5 p-5">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {data && (
                        <>
                            <UrlField
                                label="Deploy webhook (authentification API requise)"
                                value={data.deploy_webhook_url}
                                helper="Déclenche un déploiement via l’API DevForge."
                            />

                            {data.uses_git_app && (
                                <p class="rounded-xl border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
                                    Cette application utilise une Git App officielle. Les webhooks manuels ne sont pas nécessaires.
                                </p>
                            )}

                            {data.manual_webhooks_available && data.manual && (
                                <div class="grid gap-2.5 sm:gap-3 md:gap-4">
                                    <div>
                                        <p class="text-xs sm:text-sm font-semibold">Webhooks Git manuels</p>
                                        <p class="text-xs text-base-content/50">
                                            Configurez l’URL et un secret identique côté GitHub, GitLab, Bitbucket ou Gitea.
                                        </p>
                                    </div>

                                    <UrlField label="GitHub" value={data.manual.github.url} />
                                    {data.manual.github.configuration_url && (
                                        <a
                                            class="btn btn-ghost btn-sm w-fit border border-base-300/80"
                                            href={data.manual.github.configuration_url}
                                            rel="noreferrer"
                                            target="_blank"
                                        >
                                            <ExternalLink class="size-3.5" aria-hidden />
                                            Configuration webhook sur GitHub
                                        </a>
                                    )}

                                    <UrlField label="GitLab" value={data.manual.gitlab.url} />
                                    <UrlField label="Bitbucket" value={data.manual.bitbucket.url} />
                                    <UrlField label="Gitea" value={data.manual.gitea.url} />

                                    {canAct && (
                                        <div class="grid gap-2 sm:gap-3 rounded-xl border border-base-300/70 p-4">
                                            <p class="text-xs font-medium text-base-content/70">Secrets (laisser vide pour conserver)</p>
                                            {(
                                                [
                                                    ['manual_webhook_secret_github', 'Secret GitHub', data.manual.github.secret_set],
                                                    ['manual_webhook_secret_gitlab', 'Secret GitLab', data.manual.gitlab.secret_set],
                                                    ['manual_webhook_secret_bitbucket', 'Secret Bitbucket', data.manual.bitbucket.secret_set],
                                                    ['manual_webhook_secret_gitea', 'Secret Gitea', data.manual.gitea.secret_set],
                                                ] as const
                                            ).map(([key, label, secretSet]) => (
                                                <label class="grid gap-1 text-sm" key={key}>
                                                    <span class="flex items-center justify-between gap-2">
                                                        <span>{label}</span>
                                                        <span class="text-[11px] text-base-content/45">
                                                            {secretSet ? 'Déjà configuré' : 'Non défini'}
                                                        </span>
                                                    </span>
                                                    <input
                                                        class="input input-bordered w-full font-mono text-xs"
                                                        type="password"
                                                        autocomplete="new-password"
                                                        placeholder={secretSet ? '••••••••' : 'Nouveau secret'}
                                                        value={draft[key]}
                                                        onInput={(event) => {
                                                            const value = (event.target as HTMLInputElement).value;
                                                            setDraft((current) => ({ ...current, [key]: value }));
                                                        }}
                                                    />
                                                </label>
                                            ))}

                                            {error && <p class="text-xs text-error">{error}</p>}
                                            {message && <p class="text-xs text-success">{message}</p>}

                                            <button
                                                class="btn btn-primary btn-sm w-fit"
                                                type="button"
                                                disabled={saving}
                                                onClick={() => void save()}
                                            >
                                                <Save class="size-3.5" aria-hidden />
                                                {saving ? 'Enregistrement…' : 'Enregistrer les secrets'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </DataState>
            </div>
        </section>
    );
}
