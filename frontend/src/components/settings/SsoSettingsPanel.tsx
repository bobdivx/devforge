import { CheckCircle2, Circle, ExternalLink, Play, RefreshCw, Save } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { BootstrapPermissions } from '../../lib/bootstrap';
import { domainApi, instanceSsoSettings, type InstanceSettings, type InstanceSsoSettings } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';

type SsoSettingsPanelProps = {
    permissions: BootstrapPermissions;
};

function ToggleField({
    label,
    description,
    checked,
    disabled,
    onChange,
}: {
    label: string;
    description?: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label class="flex items-center justify-between gap-3 rounded-xl border border-base-300/70 px-3 py-2 text-sm">
            <span class="grid gap-0.5">
                <span>{label}</span>
                {description && (
                    <span class="text-xs font-normal text-base-content/55">{description}</span>
                )}
            </span>
            <input
                class="toggle toggle-sm shrink-0"
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) => onChange(event.currentTarget.checked)}
            />
        </label>
    );
}

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
    const Icon = ok ? CheckCircle2 : Circle;

    return (
        <li class="flex items-start gap-2 text-sm">
            <Icon class={`mt-0.5 size-4 shrink-0 ${ok ? 'text-success' : 'text-base-content/35'}`} aria-hidden />
            <span>
                <span class="font-medium">{label}</span>
                <span class="text-base-content/55"> — {detail}</span>
            </span>
        </li>
    );
}

export function SsoSettingsPanel({ permissions }: SsoSettingsPanelProps) {
    const query = useApiQuery('settings-sso', () => domainApi.settings());
    const canEdit = permissions.instance_admin;

    return (
        <div class="grid gap-4">
            <Card title="SSO Pocket ID" eyebrow={canEdit ? 'Identité' : 'Lecture seule'}>
                <div class="card-toolbar mb-3">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </div>
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {query.data && (
                        <SsoSettingsForm
                            data={query.data.data}
                            canEdit={canEdit}
                            onSaved={() => query.reload({ silent: true })}
                        />
                    )}
                </DataState>
            </Card>
        </div>
    );
}

function SsoSettingsForm({
    data,
    canEdit,
    onSaved,
}: {
    data: InstanceSettings;
    canEdit: boolean;
    onSaved: () => Promise<void>;
}) {
    const sso = instanceSsoSettings(data);
    const [protectApps, setProtectApps] = useState(sso.sso_protect_apps_by_default);
    const [hideLocalLogin, setHideLocalLogin] = useState(sso.sso_hide_local_login);
    const [saving, setSaving] = useState(false);
    const [starting, setStarting] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const setupUrl = sso.pocket_id_url ? `${sso.pocket_id_url.replace(/\/$/, '')}/setup` : null;
    const needsFirstAdmin = Boolean(setupUrl) && !sso.pocketid_login_enabled;
    const configureLabel = sso.apps_oidc_configured
        ? 'Redémarrer / reconfigurer le SSO'
        : 'Configurer le SSO';

    useEffect(() => {
        setProtectApps(sso.sso_protect_apps_by_default);
        setHideLocalLogin(sso.sso_hide_local_login);
    }, [sso.sso_protect_apps_by_default, sso.sso_hide_local_login]);

    const save = async () => {
        setSaving(true);
        setMessage(null);
        setError(null);
        try {
            await domainApi.updateSsoSettings({
                sso_protect_apps_by_default: protectApps,
                sso_hide_local_login: hideLocalLogin,
            });
            await onSaved();
            setMessage('Paramètres SSO enregistrés.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    const start = async () => {
        setStarting(true);
        setMessage(null);
        setError(null);
        try {
            await domainApi.startSsoStack();
            await onSaved();
            setMessage('SSO lancé : Pocket ID, oauth2-proxy et clients OIDC des apps.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Impossible de démarrer le SSO.');
        } finally {
            setStarting(false);
        }
    };

    return (
        <form
            class="grid gap-4"
            onSubmit={(event) => {
                event.preventDefault();
                if (canEdit && !saving) {
                    void save();
                }
            }}
        >
            <p class="text-sm text-base-content/65">
                Pocket ID est le fournisseur d’identité des apps que vous déployez.
                Chaque app reçoit au déploiement les variables OIDC (issuer, client id/secret) pour s’y connecter.
                {' '}
                (<a class="link link-primary" href="https://pocket-id.org/" target="_blank" rel="noreferrer">pocket-id.org</a>)
            </p>
            <SsoStatusList sso={sso} />
            {needsFirstAdmin && (
                <p class="text-sm">
                    Le premier compte admin se crée sur{' '}
                    <a
                        class="link link-primary inline-flex items-center gap-1"
                        href={setupUrl}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {setupUrl}
                        <ExternalLink class="size-3.5" aria-hidden />
                    </a>
                    . La page « Sign in » n’a pas encore de passkey : Authenticate y expire forcément.
                </p>
            )}
            {sso.pocket_id_url ? (
                <p class="text-sm">
                    <a class="link link-primary inline-flex items-center gap-1" href={sso.pocket_id_url} target="_blank" rel="noreferrer">
                        Ouvrir Pocket ID
                        <ExternalLink class="size-3.5" aria-hidden />
                    </a>
                    <span class="ml-2 font-mono text-xs text-base-content/55">{sso.pocket_id_url}</span>
                </p>
            ) : (
                <p class="text-sm text-warning">
                    Définissez le domaine de l’instance pour que DevForge publie Pocket ID.
                </p>
            )}
            <ToggleField
                label="Protéger les applications par défaut"
                description="Les apps déployées exigent une passkey Pocket ID avant d’être accessibles."
                checked={protectApps}
                disabled={!canEdit || saving}
                onChange={setProtectApps}
            />
            <ToggleField
                label="Masquer la connexion locale"
                description="La page de login DevForge n’affiche plus que Pocket ID."
                checked={hideLocalLogin}
                disabled={!canEdit || saving}
                onChange={setHideLocalLogin}
            />
            {error && <p class="text-sm text-error">{error}</p>}
            {message && <p class="text-sm text-base-content/60" role="status">{message}</p>}
            {canEdit && (
                <div class="grid gap-2">
                    <div class="flex flex-wrap gap-2">
                        <button
                            class={`btn btn-sm w-fit rounded-xl ${sso.apps_oidc_configured ? 'btn-outline' : 'btn-primary'}`}
                            type="button"
                            disabled={starting || saving || !sso.can_start}
                            onClick={() => void start()}
                        >
                            <Play class="size-3.5" aria-hidden />
                            {starting ? 'Configuration…' : configureLabel}
                        </button>
                        <button
                            class={`btn btn-sm w-fit rounded-xl ${sso.apps_oidc_configured ? 'btn-primary' : 'btn-outline'}`}
                            type="submit"
                            disabled={saving || starting}
                        >
                            <Save class="size-3.5" aria-hidden />
                            {saving ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                    </div>
                    <p class="text-xs text-base-content/55">
                        Configurer le SSO démarre Pocket ID et oauth2-proxy, puis enregistre les clients OIDC
                        (login DevForge + apps déployées). Redéployez ensuite les apps déjà en ligne.
                    </p>
                </div>
            )}
        </form>
    );
}

function SsoStatusList({ sso }: { sso: InstanceSsoSettings }) {
    return (
        <ul class="grid gap-1.5 rounded-xl border border-base-300/70 px-3 py-2" aria-label="État du SSO">
            <StatusRow
                ok={Boolean(sso.pocket_id_url)}
                label="Pocket ID"
                detail={sso.pocket_id_url ? sso.pocket_id_url : 'domaine manquant'}
            />
            <StatusRow
                ok={sso.pocketid_login_enabled}
                label="Compte admin"
                detail={sso.pocketid_login_enabled ? 'login Pocket ID activé' : 'créez l’admin et la passkey via /setup'}
            />
            <StatusRow
                ok={sso.apps_oidc_configured}
                label="Clients OIDC des apps"
                detail={sso.apps_oidc_configured ? 'prêts — redéployez les apps pour injecter OIDC' : 'à lancer avec Configurer le SSO'}
            />
        </ul>
    );
}
