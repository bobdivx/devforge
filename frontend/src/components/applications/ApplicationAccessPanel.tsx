import { ExternalLink, KeyRound, LoaderCircle, Save } from 'lucide-preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { SsoAppIdentityGuide } from '../settings/SsoAppIdentityGuide';
import {
    domainApi,
    instanceSsoSettings,
    type ApplicationAdvancedSettings,
    type InstanceSsoSettings,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type Props = {
    applicationUuid: string;
    canAct: boolean;
    onChanged?: () => Promise<void> | void;
    onRedeployQueued?: (deploymentUuid: string) => void;
};

type UserSystemChoice = 'unknown' | 'yes' | 'no';

function choiceFromData(data: ApplicationAdvancedSettings): UserSystemChoice {
    if (data.has_own_user_system === true) {
        return 'yes';
    }
    if (data.has_own_user_system === false) {
        return 'no';
    }

    return 'unknown';
}

function protectionFromData(data: ApplicationAdvancedSettings): boolean {
    if (data.has_own_user_system === true) {
        return false;
    }
    if (data.is_sso_protected === true) {
        return true;
    }
    if (data.is_sso_protected === false) {
        return false;
    }

    return data.has_own_user_system === false && data.sso_protect_apps_by_default;
}

function accessSyncKey(data: ApplicationAdvancedSettings): string {
    return [
        String(data.has_own_user_system),
        String(data.is_sso_protected),
        String(data.sso_protection_active),
        String(data.sso_protect_apps_by_default),
        String(data.sso_available),
        data.pocket_id_url ?? '',
    ].join('|');
}

export function ApplicationAccessPanel({
    applicationUuid,
    canAct,
    onChanged,
    onRedeployQueued,
}: Props) {
    const query = useApiQuery(
        `application-access:${applicationUuid}`,
        () => domainApi.applicationAdvancedSettings(applicationUuid),
    );
    const settingsQuery = useApiQuery('application-access-sso-settings', () => domainApi.settings());
    const data = query.data?.data ?? null;
    const sso: InstanceSsoSettings | null = settingsQuery.data
        ? instanceSsoSettings(settingsQuery.data.data)
        : null;

    const [choice, setChoice] = useState<UserSystemChoice>('unknown');
    const [protect, setProtect] = useState(false);
    const [syncedKey, setSyncedKey] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const serverKey = data ? accessSyncKey(data) : null;

    useLayoutEffect(() => {
        if (!data || !serverKey || syncedKey === serverKey) {
            return;
        }
        setChoice(choiceFromData(data));
        setProtect(protectionFromData(data));
        setSyncedKey(serverKey);
        setError(null);
    }, [data, serverKey, syncedKey]);

    const save = async () => {
        if (!canAct || choice === 'unknown') {
            return;
        }

        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            const hasOwnUserSystem = choice === 'yes';
            const response = await domainApi.updateApplicationAdvancedSettings(applicationUuid, {
                has_own_user_system: hasOwnUserSystem,
                is_sso_protected: hasOwnUserSystem ? false : protect,
                redeploy: !hasOwnUserSystem,
            });
            const next = response.data;
            setChoice(choiceFromData(next));
            setProtect(protectionFromData(next));
            setSyncedKey(accessSyncKey(next));
            const redeploy = response.meta?.redeploy;
            if (redeploy?.queued && redeploy.deployment_uuid) {
                setMessage(`${next.message ?? 'Accès Pocket ID mis à jour.'} Redéploiement lancé pour appliquer la protection.`);
                onRedeployQueued?.(redeploy.deployment_uuid);
            } else if (redeploy?.queued === false) {
                setMessage(`${next.message ?? 'Accès Pocket ID mis à jour.'} Redéploiement ignoré (déjà en file).`);
            } else {
                setMessage(next.message ?? 'Accès Pocket ID mis à jour.');
            }
            await query.reload({ silent: true });
            await onChanged?.();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Impossible d’enregistrer l’accès Pocket ID.');
        } finally {
            setSaving(false);
        }
    };

    const ssoReady = Boolean(data?.sso_available || sso?.apps_protection_configured);
    const pocketUrl = data?.pocket_id_url ?? sso?.pocket_id_url ?? null;

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-3 sm:px-4 md:px-5 py-3 sm:py-4">
                <div>
                    <div class="flex items-center gap-2">
                        <KeyRound class="size-3.5 sm:size-4 text-base-content/45" aria-hidden />
                        <p class="text-xs sm:text-sm font-semibold">Accès Pocket ID</p>
                    </div>
                    <p class="text-xs text-base-content/50">
                        Protège le site si l’app n’a pas de comptes, ou ajoute le SSO dans un login existant
                    </p>
                </div>
                {canAct && (
                    <ActionToolbar>
                        <button
                            class="btn btn-primary btn-sm"
                            type="button"
                            disabled={saving || !data || choice === 'unknown'}
                            onClick={() => void save()}
                        >
                            {saving
                                ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                : <Save class="size-3.5" aria-hidden />}
                            Enregistrer
                        </button>
                    </ActionToolbar>
                )}
            </div>

            <div class="grid gap-2.5 sm:gap-3 md:gap-4 p-5">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {data && (
                        <>
                            {message && (
                                <p class="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success" role="status">
                                    {message}
                                </p>
                            )}
                            {error && (
                                <p class="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error" role="alert">
                                    {error}
                                </p>
                            )}
                            {!ssoReady && (
                                <p class="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                                    Pocket ID n’est pas encore configuré.{' '}
                                    <a class="link link-primary" href="/settings/sso">Ouvrir les réglages SSO</a>
                                    {' '}puis redémarrez la stack.
                                </p>
                            )}

                            <fieldset class="grid gap-2">
                                <legend class="text-xs sm:text-sm font-medium">Cette application a-t-elle déjà un système d’utilisateurs ?</legend>
                                <label
                                    class={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${
                                        choice === 'yes' ? 'border-primary/40 bg-primary/5' : 'border-base-300/70'
                                    } ${!canAct || saving ? 'pointer-events-none opacity-60' : ''}`}
                                    onClick={() => {
                                        if (!canAct || saving) {
                                            return;
                                        }
                                        setChoice('yes');
                                        setProtect(false);
                                        setMessage(null);
                                    }}
                                >
                                    <input
                                        class="radio radio-sm mt-0.5"
                                        type="radio"
                                        name={`user-system-${applicationUuid}`}
                                        checked={choice === 'yes'}
                                        disabled={!canAct || saving}
                                        aria-label="Oui, elle a ses propres comptes"
                                        onChange={() => {
                                            setChoice('yes');
                                            setProtect(false);
                                            setMessage(null);
                                        }}
                                    />
                                    <span class="grid min-w-0 gap-1">
                                        <span class="text-xs sm:text-sm font-semibold">Oui, elle a ses propres comptes</span>
                                        <span class="text-xs font-normal text-base-content/55">
                                            Le site reste public jusqu’au login de l’app. Pocket ID s’ajoute comme bouton « Continuer avec SSO ».
                                        </span>
                                    </span>
                                </label>
                                <label
                                    class={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition ${
                                        choice === 'no' ? 'border-primary/40 bg-primary/5' : 'border-base-300/70'
                                    } ${!canAct || saving ? 'pointer-events-none opacity-60' : ''}`}
                                    onClick={() => {
                                        if (!canAct || saving) {
                                            return;
                                        }
                                        setChoice('no');
                                        if (data) {
                                            setProtect(protectionFromData({ ...data, has_own_user_system: false }));
                                        }
                                        setMessage(null);
                                    }}
                                >
                                    <input
                                        class="radio radio-sm mt-0.5"
                                        type="radio"
                                        name={`user-system-${applicationUuid}`}
                                        checked={choice === 'no'}
                                        disabled={!canAct || saving}
                                        aria-label="Non, pas de login dans l’app"
                                        onChange={() => {
                                            setChoice('no');
                                            if (data) {
                                                setProtect(protectionFromData({ ...data, has_own_user_system: false }));
                                            }
                                            setMessage(null);
                                        }}
                                    />
                                    <span class="grid min-w-0 gap-1">
                                        <span class="text-xs sm:text-sm font-semibold">Non, pas de login dans l’app</span>
                                        <span class="text-xs font-normal text-base-content/55">
                                            Site vitrine, outil interne, doc… Vous pouvez exiger une passkey Pocket ID avant d’ouvrir le site.
                                        </span>
                                    </span>
                                </label>
                            </fieldset>

                            {choice === 'no' && (
                                <label class="flex items-center justify-between gap-2 sm:gap-3 rounded-xl border border-base-300/70 px-2.5 sm:px-3 py-2.5 sm:py-3 text-sm">
                                    <span class="grid gap-0.5">
                                        <span class="font-medium">Protéger l’accès au site avec Pocket ID</span>
                                        <span class="text-xs font-normal text-base-content/55">
                                            Les visiteurs s’identifient (passkey) avant d’atteindre l’application. Un redéploiement applique la barrière Traefik.
                                        </span>
                                    </span>
                                    <input
                                        class="toggle toggle-sm shrink-0"
                                        type="checkbox"
                                        checked={protect}
                                        disabled={!canAct || saving || !ssoReady}
                                        aria-label="Protéger l’accès au site avec Pocket ID"
                                        onChange={(event) => {
                                            setProtect(event.currentTarget.checked);
                                            setMessage(null);
                                        }}
                                    />
                                </label>
                            )}

                            {choice === 'no' && protect && ssoReady && pocketUrl && (
                                <p class="text-xs text-base-content/55">
                                    Identité :{' '}
                                    <a class="link link-primary inline-flex items-center gap-1" href={pocketUrl} target="_blank" rel="noreferrer">
                                        {pocketUrl}
                                        <ExternalLink class="size-3" aria-hidden />
                                    </a>
                                </p>
                            )}

                            {choice === 'yes' && sso && (
                                <SsoAppIdentityGuide
                                    sso={sso}
                                    appsWildcardDomain={data.apps_wildcard_domain ?? settingsQuery.data?.data.instance.apps_wildcard_domain}
                                />
                            )}
                        </>
                    )}
                </DataState>
            </div>
        </section>
    );
}
