import { ExternalLink, RefreshCw, Save } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { BootstrapPermissions } from '../../lib/bootstrap';
import { domainApi, instanceSsoSettings, type InstanceSettings } from '../../lib/domain-api';
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

    useEffect(() => {
        setProtectApps(sso.sso_protect_apps_by_default);
        setHideLocalLogin(sso.sso_hide_local_login);
    }, [sso]);

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
            setMessage('Démarrage de Pocket ID lancé par DevForge.');
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
                <div class="flex flex-wrap gap-2">
                    <button class="btn btn-primary btn-sm w-fit rounded-xl" type="submit" disabled={saving || starting}>
                        <Save class="size-3.5" aria-hidden />
                        {saving ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                    <button
                        class="btn btn-outline btn-sm w-fit rounded-xl"
                        type="button"
                        disabled={starting || saving || !sso.can_start}
                        onClick={() => void start()}
                    >
                        {starting ? 'Démarrage…' : 'Démarrer / redémarrer Pocket ID'}
                    </button>
                </div>
            )}
        </form>
    );
}
