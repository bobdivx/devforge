import { ExternalLink, Globe, LoaderCircle, RefreshCw, Sparkles } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { ApiError } from '../../lib/api-client';
import { visitUrl } from '../../lib/application-config';
import {
    domainApi,
    type ApplicationDomainRedirect,
    type ApplicationDomains,
    type DomainConflict,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type ApplicationDomainsPanelProps = {
    applicationUuid: string;
    canAct: boolean;
    onChanged?: () => Promise<void> | void;
};

function conflictsFromError(error: unknown): DomainConflict[] {
    if (!(error instanceof ApiError) || error.status !== 409 || !error.payload || typeof error.payload !== 'object') {
        return [];
    }

    const conflicts = (error.payload as { conflicts?: unknown }).conflicts;

    return Array.isArray(conflicts) ? conflicts as DomainConflict[] : [];
}

export function ApplicationDomainsPanel({
    applicationUuid,
    canAct,
    onChanged,
}: ApplicationDomainsPanelProps) {
    const query = useApiQuery(
        `application-domains:${applicationUuid}`,
        () => domainApi.applicationDomains(applicationUuid),
    );
    const data = query.data?.data ?? null;

    const [domainsText, setDomainsText] = useState<string | null>(null);
    const [redirect, setRedirect] = useState<ApplicationDomainRedirect | null>(null);
    const [saving, setSaving] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [pendingForce, setPendingForce] = useState(false);
    const [conflicts, setConflicts] = useState<DomainConflict[]>([]);
    const [syncedKey, setSyncedKey] = useState<string | null>(null);

    const serverKey = data
        ? `${data.fqdn ?? ''}|${data.redirect}|${data.domains.join(',')}`
        : null;
    const domainsValue = domainsText ?? data?.domains.join(', ') ?? '';
    const redirectValue = redirect ?? data?.redirect ?? 'both';

    useEffect(() => {
        if (!data || !serverKey || syncedKey === serverKey) {
            return;
        }

        setDomainsText(data.domains.join(', '));
        setRedirect(data.redirect);
        setSyncedKey(serverKey);
    }, [data, serverKey, syncedKey]);

    const applyResult = async (result: ApplicationDomains, message: string) => {
        const nextKey = `${result.fqdn ?? ''}|${result.redirect}|${result.domains.join(',')}`;
        setDomainsText(result.domains.join(', '));
        setRedirect(result.redirect);
        setSyncedKey(nextKey);
        setSuccess(message);
        setError(null);
        await query.reload({ silent: true });
        await onChanged?.();
    };

    const save = async (force = false) => {
        setSaving(true);
        setError(null);
        setSuccess(null);
        setConflicts([]);

        try {
            const response = await domainApi.updateApplicationDomains(applicationUuid, {
                domains: domainsValue,
                redirect: redirectValue,
                force_domain_override: force,
            });
            await applyResult(response.data, 'Domaines enregistrés.');
            setPendingForce(false);
        } catch (err) {
            const domainConflicts = conflictsFromError(err);
            if (domainConflicts.length > 0) {
                setConflicts(domainConflicts);
                setPendingForce(true);
                setError('Conflits de domaines détectés. Confirmez pour forcer l’enregistrement.');
            } else {
                setError(err instanceof Error ? err.message : 'Impossible d’enregistrer les domaines.');
            }
        } finally {
            setSaving(false);
        }
    };

    const generate = async () => {
        setGenerating(true);
        setError(null);
        setSuccess(null);

        try {
            const response = await domainApi.generateApplicationDomain(applicationUuid);
            await applyResult(
                response.data,
                response.data.wildcard_domain
                    ? 'Domaine généré depuis le wildcard du serveur.'
                    : 'Domaine généré (fallback sslip.io — configurez le wildcard du serveur).',
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Impossible de générer un domaine.');
        } finally {
            setGenerating(false);
        }
    };

    const dockerCompose = data?.build_pack === 'dockercompose';

    return (
        <section class="min-w-0 overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-4 py-4 sm:px-5">
                <div class="min-w-0">
                    <p class="text-sm font-semibold">Domaines</p>
                    <p class="text-xs text-base-content/50">
                        URLs publiques de l’application (comme dans Coolify). Une URL par entrée, séparées par des virgules.
                    </p>
                </div>
                <ActionToolbar>
                    <button class="btn btn-ghost btn-sm rounded-full" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </ActionToolbar>
            </div>

            <div class="grid gap-4 p-4 sm:p-5">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {data && (
                        <>
                            <div class="rounded-xl border border-base-300/60 bg-base-200/30 p-3 text-xs text-base-content/65">
                                <p>
                                    <span class="font-medium text-base-content/80">Wildcard serveur : </span>
                                    {data.wildcard_domain ?? 'non configuré (fallback sslip.io)'}
                                </p>
                                <p class="mt-1">
                                    Configurez le wildcard sur la page du serveur pour que les nouvelles apps (et « Générer ») utilisent votre domaine.
                                </p>
                            </div>

                            {dockerCompose ? (
                                <p class="text-sm text-base-content/60">
                                    Cette application utilise Docker Compose : les domaines se configurent par service dans Coolify.
                                </p>
                            ) : (
                                <>
                                    <label class="grid gap-2">
                                        <span class="text-xs font-medium uppercase tracking-wide text-base-content/45">
                                            Domaines
                                        </span>
                                        <textarea
                                            class="textarea textarea-bordered min-h-24 w-full font-mono text-sm"
                                            value={domainsValue}
                                            disabled={!canAct || saving || generating}
                                            placeholder="https://mon-app.example.com, https://www.mon-app.example.com"
                                            onInput={(event) => setDomainsText((event.target as HTMLTextAreaElement).value)}
                                        />
                                    </label>

                                    <label class="grid max-w-xs gap-2">
                                        <span class="text-xs font-medium uppercase tracking-wide text-base-content/45">
                                            Redirection www
                                        </span>
                                        <select
                                            class="select select-bordered select-sm"
                                            value={redirectValue}
                                            disabled={!canAct || saving || generating}
                                            onChange={(event) => setRedirect((event.target as HTMLSelectElement).value as ApplicationDomainRedirect)}
                                        >
                                            <option value="both">Les deux (sans redirection)</option>
                                            <option value="www">Rediriger vers www</option>
                                            <option value="non-www">Rediriger vers non-www</option>
                                        </select>
                                    </label>

                                    {data.sslip_warning && (
                                        <p class="text-sm text-warning" role="status">
                                            Ce domaine utilise sslip.io — pratique en local, peu adapté en production.
                                        </p>
                                    )}

                                    {data.domains.length > 0 && (
                                        <div class="grid gap-3">
                                            {(() => {
                                                const primaryHref = visitUrl(data.domains[0] ?? null);

                                                return primaryHref ? (
                                                    <a
                                                        class="btn btn-primary btn-sm w-fit rounded-full"
                                                        href={primaryHref}
                                                        rel="noreferrer"
                                                        target="_blank"
                                                    >
                                                        <ExternalLink class="size-3.5" aria-hidden />
                                                        Ouvrir l’adresse provisoire
                                                    </a>
                                                ) : null;
                                            })()}
                                            <ul class="grid gap-2">
                                                {data.domains.map((domain) => {
                                                    const href = visitUrl(domain);

                                                    return (
                                                        <li key={domain}>
                                                            {href ? (
                                                                <a
                                                                    class="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                                                                    href={href}
                                                                    rel="noreferrer"
                                                                    target="_blank"
                                                                >
                                                                    <Globe class="size-3.5 shrink-0" aria-hidden />
                                                                    <span class="truncate">{domain}</span>
                                                                    <ExternalLink class="size-3 shrink-0 opacity-60" aria-hidden />
                                                                </a>
                                                            ) : (
                                                                <span class="text-sm">{domain}</span>
                                                            )}
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </div>
                                    )}

                                    {canAct && (
                                        <ActionToolbar>
                                            <button
                                                class="btn btn-primary btn-sm rounded-full"
                                                type="button"
                                                disabled={saving || generating}
                                                onClick={() => void save(false)}
                                            >
                                                {saving ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden /> : null}
                                                Enregistrer
                                            </button>
                                            <button
                                                class="btn btn-ghost btn-sm rounded-full border border-base-300/80"
                                                type="button"
                                                disabled={saving || generating}
                                                onClick={() => void generate()}
                                            >
                                                {generating
                                                    ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                                    : <Sparkles class="size-3.5" aria-hidden />}
                                                Générer un domaine
                                            </button>
                                        </ActionToolbar>
                                    )}
                                </>
                            )}

                            {success && <p class="text-sm text-success" role="status">{success}</p>}
                            {error && <p class="text-sm text-error" role="alert">{error}</p>}
                        </>
                    )}
                </DataState>
            </div>

            {pendingForce && (
                <ConfirmDialog
                    open
                    title="Forcer les domaines ?"
                    message={
                        conflicts.length > 0
                            ? `Conflits : ${conflicts.map((item) => item.message ?? item.domain).filter(Boolean).join(' · ')}`
                            : 'Des conflits de domaines ont été détectés. Continuer quand même ?'
                    }
                    tone="danger"
                    loading={saving}
                    onCancel={() => {
                        setPendingForce(false);
                        setConflicts([]);
                    }}
                    onConfirm={() => void save(true)}
                />
            )}
        </section>
    );
}
