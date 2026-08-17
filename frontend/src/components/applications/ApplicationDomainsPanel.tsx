import { ExternalLink, Globe, LoaderCircle, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { ApiError } from '../../lib/api-client';
import { ensureDomainScheme, visitUrl } from '../../lib/application-config';
import {
    domainApi,
    type ApplicationDomainRedirect,
    type ApplicationDomainRedeploy,
    type ApplicationDomains,
    type DomainConflict,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type ApplicationDomainsPanelProps = {
    applicationUuid: string;
    canAct: boolean;
    onChanged?: () => Promise<void> | void;
    onRedeployQueued?: (deploymentUuid: string) => void;
};

type DomainRow = {
    id: string;
    url: string;
    managed: boolean;
};

function conflictsFromError(error: unknown): DomainConflict[] {
    if (!(error instanceof ApiError) || error.status !== 409 || !error.payload || typeof error.payload !== 'object') {
        return [];
    }

    const conflicts = (error.payload as { conflicts?: unknown }).conflicts;

    return Array.isArray(conflicts) ? conflicts as DomainConflict[] : [];
}

function isManagedDomain(url: string, managedDomain: string | null | undefined): boolean {
    if (!managedDomain) {
        return false;
    }

    return url.trim().toLowerCase() === managedDomain.trim().toLowerCase();
}

function rowsFromDomains(domains: string[], managedDomain: string | null | undefined): DomainRow[] {
    const list = domains.length > 0 ? domains : [''];

    return list.map((url, index) => ({
        id: `domain-${index}-${url || 'empty'}`,
        url,
        managed: isManagedDomain(url, managedDomain),
    }));
}

function serializeRows(rows: DomainRow[]): string {
    return rows
        .map((row) => ensureDomainScheme(row.url))
        .filter(Boolean)
        .join(', ');
}

function redeploySuccessMessage(baseMessage: string, redeploy: ApplicationDomainRedeploy | null | undefined): string {
    if (redeploy?.queued && redeploy.deployment_uuid) {
        return `${baseMessage} Redéploiement lancé pour appliquer le routage proxy.`;
    }

    if (redeploy?.queued === false) {
        return `${baseMessage} Redéploiement ignoré (déjà en file).`;
    }

    return baseMessage;
}

let domainRowSeq = 0;

function nextRowId(): string {
    domainRowSeq += 1;

    return `domain-row-${domainRowSeq}`;
}

export function ApplicationDomainsPanel({
    applicationUuid,
    canAct,
    onChanged,
    onRedeployQueued,
}: ApplicationDomainsPanelProps) {
    const query = useApiQuery(
        `application-domains:${applicationUuid}`,
        () => domainApi.applicationDomains(applicationUuid),
    );
    const data = query.data?.data ?? null;

    const [rows, setRows] = useState<DomainRow[]>([]);
    const [redirect, setRedirect] = useState<ApplicationDomainRedirect>('both');
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [pendingForce, setPendingForce] = useState(false);
    const [conflicts, setConflicts] = useState<DomainConflict[]>([]);
    const [syncedKey, setSyncedKey] = useState<string | null>(null);

    const serverKey = data
        ? `${data.fqdn ?? ''}|${data.redirect}|${data.domains.join(',')}|${data.managed_domain ?? ''}`
        : null;
    const domainsValue = serializeRows(rows);
    const managedDomain = data?.managed_domain ?? null;

    useEffect(() => {
        if (!data || !serverKey || dirty || syncedKey === serverKey) {
            return;
        }

        setRows(rowsFromDomains(data.domains, data.managed_domain));
        setRedirect(data.redirect);
        setSyncedKey(serverKey);
    }, [data, serverKey, syncedKey, dirty]);

    const applyResult = async (result: ApplicationDomains, message: string) => {
        const nextKey = `${result.fqdn ?? ''}|${result.redirect}|${result.domains.join(',')}|${result.managed_domain ?? ''}`;
        setRows(rowsFromDomains(result.domains, result.managed_domain));
        setRedirect(result.redirect);
        setSyncedKey(nextKey);
        setDirty(false);
        setSuccess(message);
        setError(null);
        await query.reload({ silent: true });
        await onChanged?.();
    };

    const updateRow = (id: string, url: string) => {
        setDirty(true);
        setRows((current) => current.map((row) => (row.id === id && !row.managed ? { ...row, url } : row)));
    };

    const removeRow = (id: string) => {
        setDirty(true);
        setRows((current) => {
            const next = current.filter((row) => row.id !== id || row.managed);

            return next.length > 0 ? next : [{ id: nextRowId(), url: '', managed: false }];
        });
    };

    const addRow = () => {
        setDirty(true);
        setRows((current) => [...current, { id: nextRowId(), url: '', managed: false }]);
    };

    const save = async (force = false) => {
        setSaving(true);
        setError(null);
        setSuccess(null);
        setConflicts([]);

        try {
            const response = await domainApi.updateApplicationDomains(applicationUuid, {
                domains: domainsValue,
                redirect,
                force_domain_override: force,
                redeploy: true,
            });
            await applyResult(
                response.data,
                redeploySuccessMessage('Domaines enregistrés.', response.meta?.redeploy),
            );
            if (response.meta?.redeploy?.queued && response.meta.redeploy.deployment_uuid) {
                onRedeployQueued?.(response.meta.redeploy.deployment_uuid);
            }
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
            const response = await domainApi.generateApplicationDomain(applicationUuid, { redeploy: true });
            await applyResult(
                response.data,
                redeploySuccessMessage(
                    response.data.wildcard_domain
                        ? 'Domaine DevForge ajouté (les domaines personnalisés sont conservés).'
                        : 'Domaine DevForge ajouté via sslip.io (configurez le wildcard du serveur).',
                    response.meta?.redeploy,
                ),
            );
            if (response.meta?.redeploy?.queued && response.meta.redeploy.deployment_uuid) {
                onRedeployQueued?.(response.meta.redeploy.deployment_uuid);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Impossible de générer un domaine.');
        } finally {
            setGenerating(false);
        }
    };

    const dockerCompose = data?.build_pack === 'dockercompose';
    const primaryManagedHref = visitUrl(managedDomain);
    const filledCustomDomains = rows.filter((row) => !row.managed && row.url.trim() !== '');
    const formReady = Boolean(data && syncedKey === serverKey) || dirty;

    return (
        <section class="min-w-0 overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-4 py-4 sm:px-5">
                <div class="min-w-0">
                    <p class="text-sm font-semibold">Domaines</p>
                    <p class="text-xs text-base-content/50">
                        Une URL par ligne. Le domaine DevForge (généré) est toujours conservé.
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
                                    Cette application utilise Docker Compose : les domaines se configurent par service dans DevForge.
                                </p>
                            ) : !formReady ? (
                                <p class="text-sm text-base-content/50">Chargement des domaines…</p>
                            ) : (
                                <>
                                    <div class="grid gap-3">
                                        <div class="flex items-center justify-between gap-3">
                                            <span class="text-xs font-medium uppercase tracking-wide text-base-content/45">
                                                Liste des domaines
                                            </span>
                                            {canAct && (
                                                <button
                                                    class="btn btn-ghost btn-xs rounded-full"
                                                    type="button"
                                                    disabled={saving || generating}
                                                    onClick={addRow}
                                                >
                                                    <Plus class="size-3.5" aria-hidden />
                                                    Ajouter
                                                </button>
                                            )}
                                        </div>

                                        <ul class="grid gap-2">
                                            {rows.map((row, index) => {
                                                const href = visitUrl(row.url.trim() || null);

                                                return (
                                                    <li
                                                        key={row.id}
                                                        class="grid gap-2 rounded-xl border border-base-300/60 bg-base-200/20 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                                                    >
                                                        <div class="grid min-w-0 gap-2">
                                                            <div class="flex flex-wrap items-center gap-2">
                                                                <span class="text-[11px] font-medium uppercase tracking-wide text-base-content/40">
                                                                    {row.managed ? 'Domaine DevForge' : `Domaine ${index + 1}`}
                                                                </span>
                                                                {row.managed && (
                                                                    <span class="badge badge-sm badge-ghost border-primary/30 text-primary">
                                                                        Protégé
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div class="flex min-w-0 items-center gap-2">
                                                                <Globe class="size-3.5 shrink-0 text-base-content/40" aria-hidden />
                                                                <input
                                                                    class="input input-bordered input-sm min-w-0 flex-1 font-mono text-sm"
                                                                    type="url"
                                                                    value={row.url}
                                                                    disabled={!canAct || saving || generating || row.managed}
                                                                    placeholder="https://mon-app.example.com"
                                                                    aria-label={row.managed ? 'Domaine DevForge' : `Domaine personnalisé ${index + 1}`}
                                                                    onInput={(event) => updateRow(row.id, (event.currentTarget as HTMLInputElement).value)}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div class="flex flex-wrap items-center gap-2 sm:justify-end">
                                                            {href && (
                                                                <a
                                                                    class="btn btn-ghost btn-xs rounded-full"
                                                                    href={href}
                                                                    rel="noreferrer"
                                                                    target="_blank"
                                                                    title="Ouvrir"
                                                                >
                                                                    <ExternalLink class="size-3.5" aria-hidden />
                                                                    Ouvrir
                                                                </a>
                                                            )}
                                                            {canAct && !row.managed && (
                                                                <button
                                                                    class="btn btn-ghost btn-xs rounded-full text-error"
                                                                    type="button"
                                                                    disabled={saving || generating || (rows.length === 1 && !row.url)}
                                                                    onClick={() => removeRow(row.id)}
                                                                    aria-label={`Supprimer le domaine ${index + 1}`}
                                                                >
                                                                    <Trash2 class="size-3.5" aria-hidden />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ul>

                                        {managedDomain === null && canAct && (
                                            <p class="text-xs text-base-content/50">
                                                Aucun domaine DevForge pour l’instant. Utilisez « Générer un domaine » pour en créer un (conservé ensuite).
                                            </p>
                                        )}
                                    </div>

                                    <label class="grid max-w-xs gap-2">
                                        <span class="text-xs font-medium uppercase tracking-wide text-base-content/45">
                                            Redirection www
                                        </span>
                                        <select
                                            class="select select-bordered select-sm"
                                            value={redirect}
                                            disabled={!canAct || saving || generating}
                                            onChange={(event) => {
                                                setDirty(true);
                                                setRedirect((event.currentTarget as HTMLSelectElement).value as ApplicationDomainRedirect);
                                            }}
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

                                    {primaryManagedHref && (
                                        <a
                                            class="btn btn-primary btn-sm w-fit rounded-full"
                                            href={primaryManagedHref}
                                            rel="noreferrer"
                                            target="_blank"
                                        >
                                            <ExternalLink class="size-3.5" aria-hidden />
                                            Ouvrir l’adresse provisoire
                                        </a>
                                    )}

                                    {!primaryManagedHref && filledCustomDomains.length > 0 && (() => {
                                        const href = visitUrl(filledCustomDomains[0]?.url ?? null);

                                        return href ? (
                                            <a
                                                class="btn btn-primary btn-sm w-fit rounded-full"
                                                href={href}
                                                rel="noreferrer"
                                                target="_blank"
                                            >
                                                <ExternalLink class="size-3.5" aria-hidden />
                                                Ouvrir le domaine principal
                                            </a>
                                        ) : null;
                                    })()}

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
                                                {managedDomain ? 'Régénérer le domaine DevForge' : 'Générer un domaine'}
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
