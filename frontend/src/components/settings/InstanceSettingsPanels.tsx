import { ArrowUpCircle, RefreshCw, Save } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { Card } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { CronInput } from '../ui/CronInput';
import { HiddenUsernameField } from '../ui/HiddenUsernameField';
import type { BootstrapPermissions } from '../../lib/bootstrap';
import {
    domainApi,
    type InstanceSettings,
    type OauthProviderSettings,
} from '../../lib/domain-api';
import { notifyInstanceUpgradeChanged } from '../../lib/instance-upgrade';
import { normalizeAppsWildcardDomain, previewDefaultApplicationUrl } from '../../lib/onboarding-steps';
import { useApiQuery } from '../../lib/use-api-query';

type InstanceSettingsPanelsProps = {
    section: 'instance' | 'advanced' | 'email' | 'updates';
    permissions: BootstrapPermissions;
    legacyBaseUrl: string;
};

const titles: Record<InstanceSettingsPanelsProps['section'], string> = {
    instance: 'Instance',
    advanced: 'Paramètres avancés',
    email: 'E-mail transactionnel',
    updates: 'Mises à jour',
};

function Field({
    label,
    children,
}: {
    label: string;
    children: preact.ComponentChildren;
}) {
    return (
        <label class="grid gap-1.5 text-sm">
            <span class="font-medium">{label}</span>
            {children}
        </label>
    );
}

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
        <label class="flex items-center justify-between gap-2 sm:gap-3 rounded-xl border border-base-300/70 px-3 py-2 text-sm">
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

function InstanceForm({
    data,
    canEdit,
    onSaved,
}: {
    data: InstanceSettings['instance'];
    canEdit: boolean;
    onSaved: () => Promise<void>;
}) {
    const [form, setForm] = useState(data);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!dirty) {
            setForm(data);
        }
    }, [data, dirty]);

    const updateForm = (patch: Partial<InstanceSettings['instance']>) => {
        setDirty(true);
        setForm((current) => ({ ...current, ...patch }));
    };

    const save = async () => {
        setSaving(true);
        setMessage(null);
        setError(null);
        try {
            const appsDomain = form.apps_wildcard_domain?.trim()
                ? normalizeAppsWildcardDomain(form.apps_wildcard_domain)
                : null;
            if (form.apps_wildcard_domain?.trim() && !appsDomain) {
                setError('Indiquez un domaine valide, par exemple exemple.com');
                setSaving(false);
                return;
            }

            await domainApi.updateInstanceSettings({
                instance_name: form.instance_name,
                fqdn: form.fqdn || null,
                apps_wildcard_domain: appsDomain,
                instance_timezone: form.instance_timezone || undefined,
                public_ipv4: form.public_ipv4,
                public_ipv6: form.public_ipv6,
                public_port_min: form.public_port_min ?? undefined,
                public_port_max: form.public_port_max ?? undefined,
                dev_helper_version: form.dev_helper_version,
                force_save_domains: true,
            });
            setDirty(false);
            await onSaved();
            setMessage(appsDomain
                ? `Domaine des applications enregistré. Les nouvelles URLs ressemblent à ${previewDefaultApplicationUrl('starbasefr', appsDomain)}.`
                : 'Paramètres enregistrés.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div class="grid gap-3">
            <div class="grid gap-2 sm:gap-3 md:grid-cols-2">
                <Field label="Nom">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        value={form.instance_name ?? ''}
                        disabled={!canEdit || saving}
                        onInput={(event) => updateForm({ instance_name: event.currentTarget.value })}
                    />
                </Field>
                <Field label="URL instance">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        value={form.fqdn ?? ''}
                        disabled={!canEdit || saving}
                        placeholder="https://devforge.example.com"
                        onInput={(event) => updateForm({ fqdn: event.currentTarget.value || null })}
                    />
                </Field>
                <Field label="Domaine des applications">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        value={(form.apps_wildcard_domain ?? '').replace(/^https?:\/\//i, '')}
                        disabled={!canEdit || saving}
                        placeholder="exemple.com"
                        inputMode="url"
                        onInput={(event) => updateForm({
                            apps_wildcard_domain: event.currentTarget.value || null,
                        })}
                    />
                    <span class="text-xs font-normal text-base-content/55">
                        Toutes les apps reçoivent par défaut nomdelapp.ce-domaine
                        {previewDefaultApplicationUrl('starbasefr', form.apps_wildcard_domain ?? '') !== ''
                            ? `, aperçu : ${previewDefaultApplicationUrl('starbasefr', form.apps_wildcard_domain ?? '')}`
                            : ', par exemple starbasefr.exemple.com'}
                        . Les URLs générées des apps déjà déployées sont mises à jour.
                    </span>
                </Field>
                <Field label="Fuseau">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        value={form.instance_timezone ?? ''}
                        disabled={!canEdit || saving}
                        onInput={(event) => updateForm({ instance_timezone: event.currentTarget.value })}
                    />
                </Field>
                <Field label="IPv4 publique">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        value={form.public_ipv4 ?? ''}
                        disabled={!canEdit || saving}
                        onInput={(event) => updateForm({ public_ipv4: event.currentTarget.value || null })}
                    />
                </Field>
                <Field label="IPv6 publique">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        value={form.public_ipv6 ?? ''}
                        disabled={!canEdit || saving}
                        onInput={(event) => updateForm({ public_ipv6: event.currentTarget.value || null })}
                    />
                </Field>
                <Field label="Port public min">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        type="number"
                        min={1025}
                        max={65535}
                        value={form.public_port_min ?? ''}
                        disabled={!canEdit || saving}
                        onInput={(event) => updateForm({
                            public_port_min: event.currentTarget.value === '' ? null : Number(event.currentTarget.value),
                        })}
                    />
                </Field>
                <Field label="Port public max">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        type="number"
                        min={1025}
                        max={65535}
                        value={form.public_port_max ?? ''}
                        disabled={!canEdit || saving}
                        onInput={(event) => updateForm({
                            public_port_max: event.currentTarget.value === '' ? null : Number(event.currentTarget.value),
                        })}
                    />
                </Field>
            </div>
            <p class="text-xs text-base-content/55">
                Canal : {form.next_channel ?? '—'} · Helper : {form.helper_version ?? '—'}
            </p>
            {error && <p class="text-sm text-error">{error}</p>}
            {message && <p class="text-sm text-base-content/60" role="status">{message}</p>}
            {canEdit && (
                <button class="btn btn-primary btn-sm w-fit rounded-xl" type="button" disabled={saving} onClick={() => void save()}>
                    <Save class="size-3.5" aria-hidden />
                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
            )}
        </div>
    );
}

function defaultAgentsSettings(): InstanceSettings['advanced']['agents'] {
    return {
        dynamic_roles_enabled: true,
        role_model_routing: true,
        collab_enabled: true,
        code_sandbox_enabled: true,
        mcp_client_enabled: true,
        mcp_servers: [],
    };
}

function AdvancedForm({
    data,
    canEdit,
    onSaved,
}: {
    data: InstanceSettings['advanced'];
    canEdit: boolean;
    onSaved: () => Promise<void>;
}) {
    const [form, setForm] = useState({
        ...data,
        agents: data.agents ?? defaultAgentsSettings(),
    });
    const [mcpServersJson, setMcpServersJson] = useState(
        () => JSON.stringify((data.agents ?? defaultAgentsSettings()).mcp_servers ?? [], null, 2),
    );
    const [confirmationPassword, setConfirmationPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const agents = data.agents ?? defaultAgentsSettings();
        setForm({ ...data, agents });
        setMcpServersJson(JSON.stringify(agents.mcp_servers ?? [], null, 2));
        setConfirmationPassword('');
    }, [data]);

    const needsPassword = (form.is_registration_enabled && !data.is_registration_enabled)
        || (form.disable_two_step_confirmation && !data.disable_two_step_confirmation);

    const save = async () => {
        setSaving(true);
        setMessage(null);
        setError(null);
        try {
            let mcpServers = form.agents.mcp_servers;
            try {
                const parsed = JSON.parse(mcpServersJson || '[]');
                if (!Array.isArray(parsed)) {
                    throw new Error('mcp_servers doit être un tableau JSON');
                }
                mcpServers = parsed;
            } catch (parseError) {
                setError(parseError instanceof Error ? parseError.message : 'JSON serveurs MCP invalide.');
                setSaving(false);
                return;
            }

            await domainApi.updateAdvancedSettings({
                ...form,
                agents: {
                    ...form.agents,
                    mcp_servers: mcpServers,
                },
                confirmation_password: needsPassword ? confirmationPassword : undefined,
            });
            await onSaved();
            setMessage('Paramètres avancés enregistrés.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    const setAgentFlag = (key: keyof InstanceSettings['advanced']['agents'], value: boolean) => {
        setForm((current) => ({
            ...current,
            agents: {
                ...current.agents,
                [key]: value,
            },
        }));
    };

    return (
        <form
            class="grid gap-3"
            onSubmit={(event) => {
                event.preventDefault();
                if (canEdit && !saving) {
                    void save();
                }
            }}
        >
            <HiddenUsernameField />
            <ToggleField
                label="Inscriptions"
                checked={form.is_registration_enabled}
                disabled={!canEdit || saving}
                onChange={(value) => setForm((current) => ({ ...current, is_registration_enabled: value }))}
            />
            <ToggleField
                label="Ne pas suivre"
                checked={form.do_not_track}
                disabled={!canEdit || saving}
                onChange={(value) => setForm((current) => ({ ...current, do_not_track: value }))}
            />
            <ToggleField
                label="Validation DNS"
                checked={form.is_dns_validation_enabled}
                disabled={!canEdit || saving}
                onChange={(value) => setForm((current) => ({ ...current, is_dns_validation_enabled: value }))}
            />
            <Field label="Serveurs DNS">
                <input
                    class="input input-bordered input-sm w-full rounded-xl"
                    value={form.custom_dns_servers ?? ''}
                    disabled={!canEdit || saving}
                    placeholder="1.1.1.1,8.8.8.8"
                    onInput={(event) => setForm((current) => ({ ...current, custom_dns_servers: event.currentTarget.value || null }))}
                />
            </Field>
            <ToggleField
                label="API"
                checked={form.is_api_enabled}
                disabled={!canEdit || saving}
                onChange={(value) => setForm((current) => ({ ...current, is_api_enabled: value }))}
            />
            <Field label="IP autorisées">
                <input
                    class="input input-bordered input-sm w-full rounded-xl"
                    value={form.allowed_ips ?? ''}
                    disabled={!canEdit || saving}
                    placeholder="0.0.0.0 ou CIDR"
                    onInput={(event) => setForm((current) => ({ ...current, allowed_ips: event.currentTarget.value || null }))}
                />
            </Field>
            <ToggleField
                label="Popup sponsoring"
                checked={form.is_sponsorship_popup_enabled}
                disabled={!canEdit || saving}
                onChange={(value) => setForm((current) => ({ ...current, is_sponsorship_popup_enabled: value }))}
            />
            <ToggleField
                label="Désactiver la confirmation en 2 étapes"
                checked={form.disable_two_step_confirmation}
                disabled={!canEdit || saving}
                onChange={(value) => setForm((current) => ({ ...current, disable_two_step_confirmation: value }))}
            />
            <ToggleField
                label="Navigation wire"
                checked={form.is_wire_navigate_enabled}
                disabled={!canEdit || saving}
                onChange={(value) => setForm((current) => ({ ...current, is_wire_navigate_enabled: value }))}
            />
            <ToggleField
                label="Serveur MCP"
                description="Active /mcp (lecture) et /mcp/devforge (réparation). Les clients (Cursor) utilisent un jeton API read+write — Sécurité → API & MCP."
                checked={form.is_mcp_server_enabled}
                disabled={!canEdit || saving}
                onChange={(value) => setForm((current) => ({ ...current, is_mcp_server_enabled: value }))}
            />

            <div class="mt-2 grid gap-2 rounded-xl border border-base-300/70 p-3">
                <p class="text-xs sm:text-sm font-medium">Agents autonomes</p>
                <p class="text-xs text-base-content/55">
                    Activés par défaut. Pas besoin de variables Docker Compose — coupe ici si besoin.
                </p>
                <ToggleField
                    label="Rôles dynamiques"
                    description="spawn_task avec auto_roles / roles[]"
                    checked={form.agents.dynamic_roles_enabled}
                    disabled={!canEdit || saving}
                    onChange={(value) => setAgentFlag('dynamic_roles_enabled', value)}
                />
                <ToggleField
                    label="Routage modèle par rôle"
                    description="Tier LLM selon researcher / implementer / …"
                    checked={form.agents.role_model_routing}
                    disabled={!canEdit || saving}
                    onChange={(value) => setAgentFlag('role_model_routing', value)}
                />
                <ToggleField
                    label="Mode collaboration"
                    description="orchestration=collab (speaker selection)"
                    checked={form.agents.collab_enabled}
                    disabled={!canEdit || saving}
                    onChange={(value) => setAgentFlag('collab_enabled', value)}
                />
                <ToggleField
                    label="Sandbox execute_code"
                    description="Conteneurs Docker éphémères (php/node/python)"
                    checked={form.agents.code_sandbox_enabled}
                    disabled={!canEdit || saving}
                    onChange={(value) => setAgentFlag('code_sandbox_enabled', value)}
                />
                <ToggleField
                    label="Client MCP (outils distants)"
                    description="Expose mcp__serveur__outil dans la boucle agent"
                    checked={form.agents.mcp_client_enabled}
                    disabled={!canEdit || saving}
                    onChange={(value) => setAgentFlag('mcp_client_enabled', value)}
                />
                <Field label="Serveurs MCP clients (JSON)">
                    <textarea
                        class="textarea textarea-bordered textarea-sm min-h-28 w-full rounded-xl font-mono text-xs"
                        value={mcpServersJson}
                        disabled={!canEdit || saving || !form.agents.mcp_client_enabled}
                        placeholder='[{"id":"docs","url":"https://example.com/mcp","label":"Docs","token_env":"MCP_DOCS_TOKEN"}]'
                        onInput={(event) => setMcpServersJson(event.currentTarget.value)}
                    />
                    <span class="text-xs text-base-content/55">
                        Les secrets restent hors JSON : utilise token_env (nom de variable d’environnement).
                    </span>
                </Field>
            </div>

            {needsPassword && (
                <Field label="Mot de passe de confirmation">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        type="password"
                        value={confirmationPassword}
                        disabled={!canEdit || saving}
                        autoComplete="current-password"
                        onInput={(event) => setConfirmationPassword(event.currentTarget.value)}
                    />
                </Field>
            )}
            {error && <p class="text-sm text-error">{error}</p>}
            {message && <p class="text-sm text-base-content/60" role="status">{message}</p>}
            {canEdit && (
                <button class="btn btn-primary btn-sm w-fit rounded-xl" type="submit" disabled={saving}>
                    <Save class="size-3.5" aria-hidden />
                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
            )}
        </form>
    );
}

function EmailForm({
    data,
    canEdit,
    onSaved,
}: {
    data: InstanceSettings['email'];
    canEdit: boolean;
    onSaved: () => Promise<void>;
}) {
    const [form, setForm] = useState({
        ...data,
        smtp_password: '',
        resend_api_key: '',
    });
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setForm({ ...data, smtp_password: '', resend_api_key: '' });
    }, [data]);

    const save = async () => {
        setSaving(true);
        setMessage(null);
        setError(null);
        try {
            await domainApi.updateEmailSettings({
                smtp_enabled: form.smtp_enabled,
                smtp_from_address: form.smtp_from_address,
                smtp_from_name: form.smtp_from_name,
                smtp_recipients: form.smtp_recipients,
                smtp_host: form.smtp_host,
                smtp_port: form.smtp_port,
                smtp_encryption: form.smtp_encryption,
                smtp_username: form.smtp_username,
                smtp_password: form.smtp_password || undefined,
                smtp_timeout: form.smtp_timeout,
                resend_enabled: form.resend_enabled,
                resend_api_key: form.resend_api_key || undefined,
            });
            await onSaved();
            setMessage('Paramètres e-mail enregistrés.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form
            class="grid gap-3"
            onSubmit={(event) => {
                event.preventDefault();
                if (canEdit && !saving) {
                    void save();
                }
            }}
        >
            <HiddenUsernameField />
            <ToggleField
                label="SMTP"
                checked={form.smtp_enabled}
                disabled={!canEdit || saving}
                onChange={(value) => setForm((current) => ({
                    ...current,
                    smtp_enabled: value,
                    resend_enabled: value ? false : current.resend_enabled,
                }))}
            />
            <div class="grid gap-2 sm:gap-3 md:grid-cols-2">
                <Field label="Expéditeur">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        type="email"
                        value={form.smtp_from_address ?? ''}
                        disabled={!canEdit || saving}
                        onInput={(event) => setForm((current) => ({ ...current, smtp_from_address: event.currentTarget.value || null }))}
                    />
                </Field>
                <Field label="Nom expéditeur">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        value={form.smtp_from_name ?? ''}
                        disabled={!canEdit || saving}
                        onInput={(event) => setForm((current) => ({ ...current, smtp_from_name: event.currentTarget.value || null }))}
                    />
                </Field>
                <Field label="Hôte SMTP">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        value={form.smtp_host ?? ''}
                        disabled={!canEdit || saving}
                        onInput={(event) => setForm((current) => ({ ...current, smtp_host: event.currentTarget.value || null }))}
                    />
                </Field>
                <Field label="Port">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        type="number"
                        value={form.smtp_port ?? ''}
                        disabled={!canEdit || saving}
                        onInput={(event) => setForm((current) => ({
                            ...current,
                            smtp_port: event.currentTarget.value === '' ? null : Number(event.currentTarget.value),
                        }))}
                    />
                </Field>
                <Field label="Chiffrement">
                    <select
                        class="select select-bordered select-sm w-full rounded-xl"
                        value={form.smtp_encryption ?? 'starttls'}
                        disabled={!canEdit || saving}
                        onChange={(event) => setForm((current) => ({ ...current, smtp_encryption: event.currentTarget.value }))}
                    >
                        <option value="starttls">STARTTLS</option>
                        <option value="tls">TLS</option>
                        <option value="none">Aucun</option>
                    </select>
                </Field>
                <Field label="Utilisateur">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        value={form.smtp_username ?? ''}
                        disabled={!canEdit || saving}
                        onInput={(event) => setForm((current) => ({ ...current, smtp_username: event.currentTarget.value || null }))}
                    />
                </Field>
                <Field label={`Mot de passe${data.smtp_password_set ? ' (laisser vide pour conserver)' : ''}`}>
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        type="password"
                        value={form.smtp_password}
                        disabled={!canEdit || saving}
                        onInput={(event) => setForm((current) => ({ ...current, smtp_password: event.currentTarget.value }))}
                    />
                </Field>
            </div>
            <ToggleField
                label="Resend"
                checked={form.resend_enabled}
                disabled={!canEdit || saving}
                onChange={(value) => setForm((current) => ({
                    ...current,
                    resend_enabled: value,
                    smtp_enabled: value ? false : current.smtp_enabled,
                }))}
            />
            <Field label={`Clé Resend${data.resend_api_key_set ? ' (laisser vide pour conserver)' : ''}`}>
                <input
                    class="input input-bordered input-sm w-full rounded-xl"
                    type="password"
                    value={form.resend_api_key}
                    disabled={!canEdit || saving}
                    onInput={(event) => setForm((current) => ({ ...current, resend_api_key: event.currentTarget.value }))}
                />
            </Field>
            {error && <p class="text-sm text-error">{error}</p>}
            {message && <p class="text-sm text-base-content/60" role="status">{message}</p>}
            {canEdit && (
                <button class="btn btn-primary btn-sm w-fit rounded-xl" type="submit" disabled={saving}>
                    <Save class="size-3.5" aria-hidden />
                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
            )}
        </form>
    );
}

function UpdatesForm({
    data,
    canEdit,
    onSaved,
}: {
    data: InstanceSettings['updates'];
    canEdit: boolean;
    onSaved: () => Promise<void>;
}) {
    const [form, setForm] = useState(data);
    const [saving, setSaving] = useState(false);
    const [checking, setChecking] = useState(false);
    const [upgrading, setUpgrading] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => setForm(data), [data]);

    const save = async () => {
        setSaving(true);
        setMessage(null);
        setError(null);
        try {
            await domainApi.updateUpdatesSettings({
                is_auto_update_enabled: form.is_auto_update_enabled,
                auto_update_frequency: form.auto_update_frequency,
                update_check_frequency: form.update_check_frequency,
            });
            await onSaved();
            setMessage('Paramètres de mise à jour enregistrés.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    const check = async () => {
        setChecking(true);
        setMessage(null);
        setError(null);
        try {
            const response = await domainApi.checkUpdatesSettings();
            await onSaved();
            setMessage(response.data.updates.new_version_available
                ? 'Nouvelle version disponible.'
                : 'Aucune nouvelle version.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de la vérification.');
        } finally {
            setChecking(false);
        }
    };

    const upgrade = async () => {
        setUpgrading(true);
        setMessage(null);
        setError(null);
        try {
            await domainApi.startInstanceUpgrade();
            notifyInstanceUpgradeChanged();
            await onSaved();
            setConfirmOpen(false);
            setMessage('Mise à jour lancée. Suivez la progression dans la fenêtre de mise à jour.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de la mise à jour.');
        } finally {
            setUpgrading(false);
        }
    };

    const currentVersion = form.current_version ?? '—';
    const latestVersion = form.latest_version ?? '—';

    return (
        <div class="grid gap-3">
            <div class="flex flex-wrap items-center gap-2">
                <StatusBadge
                    label={form.new_version_available ? 'Mise à jour disponible' : 'À jour'}
                    tone={form.new_version_available ? 'warning' : 'success'}
                />
                <p class="text-sm text-base-content/60">
                    {currentVersion}
                    {form.new_version_available ? ` → ${latestVersion}` : ''}
                </p>
            </div>
            <ToggleField
                label="Mises à jour auto"
                checked={form.is_auto_update_enabled}
                disabled={!canEdit || saving}
                onChange={(value) => setForm((current) => ({ ...current, is_auto_update_enabled: value }))}
            />
            <div class="mb-4">
                <CronInput
                    label="Fréquence auto"
                    value={form.auto_update_frequency ?? ''}
                    onChange={(val) => setForm((current) => ({ ...current, auto_update_frequency: val || null }))}
                />
            </div>
            <div class="mb-4">
                <CronInput
                    label="Fréquence de vérification"
                    value={form.update_check_frequency ?? ''}
                    onChange={(val) => setForm((current) => ({ ...current, update_check_frequency: val || null }))}
                />
            </div>
            {error && <p class="text-sm text-error">{error}</p>}
            {message && <p class="text-sm text-base-content/60" role="status">{message}</p>}
            {canEdit && (
                <div class="flex flex-wrap gap-2">
                    <button class="btn btn-primary btn-sm rounded-xl" type="button" disabled={saving || checking || upgrading} onClick={() => void save()}>
                        <Save class="size-3.5" aria-hidden />
                        {saving ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                    <button class="btn btn-ghost btn-sm rounded-xl" type="button" disabled={saving || checking || upgrading} onClick={() => void check()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        {checking ? 'Vérification…' : 'Vérifier maintenant'}
                    </button>
                    {form.new_version_available && (
                        <button
                            class="btn btn-warning btn-sm rounded-xl"
                            type="button"
                            disabled={saving || checking || upgrading}
                            onClick={() => setConfirmOpen(true)}
                        >
                            <ArrowUpCircle class="size-3.5" aria-hidden />
                            {upgrading ? 'Mise à jour…' : 'Mettre à jour maintenant'}
                        </button>
                    )}
                </div>
            )}
            <ConfirmDialog
                open={confirmOpen}
                title="Mettre à jour DevForge ?"
                message={`La version ${currentVersion} va être mise à jour vers ${latestVersion}. L’interface sera indisponible pendant le redémarrage.`}
                confirmLabel="Mettre à jour maintenant"
                cancelLabel="Annuler"
                loading={upgrading}
                onConfirm={() => void upgrade()}
                onCancel={() => setConfirmOpen(false)}
            />
        </div>
    );
}

export function InstanceSettingsPanels({ section, permissions }: InstanceSettingsPanelsProps) {
    const settings = useApiQuery('settings', () => domainApi.settings());
    const data = settings.data?.data;
    const canEdit = permissions.instance_admin;

    return (
        <div class="grid gap-4">
            <Card title={titles[section]} eyebrow={canEdit ? 'Administrateur' : 'Lecture seule'}>
                <div class="card-toolbar mb-3">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void settings.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </div>
                <DataState loading={settings.loading} error={settings.error} onRetry={() => void settings.reload()}>
                    {data && section === 'instance' && (
                        <InstanceForm data={data.instance} canEdit={canEdit} onSaved={settings.reload} />
                    )}
                    {data && section === 'advanced' && (
                        <AdvancedForm data={data.advanced} canEdit={canEdit} onSaved={settings.reload} />
                    )}
                    {data && section === 'email' && (
                        <EmailForm data={data.email} canEdit={canEdit} onSaved={settings.reload} />
                    )}
                    {data && section === 'updates' && (
                        <UpdatesForm data={data.updates} canEdit={canEdit} onSaved={settings.reload} />
                    )}
                </DataState>
            </Card>
        </div>
    );
}

function OauthProviderForm({
    provider,
    canEdit,
    onSaved,
}: {
    provider: OauthProviderSettings;
    canEdit: boolean;
    onSaved: () => Promise<void>;
}) {
    const [form, setForm] = useState({
        enabled: provider.enabled,
        client_id: provider.client_id ?? '',
        client_secret: '',
        redirect_uri: provider.redirect_uri ?? '',
        tenant: provider.tenant ?? '',
        base_url: provider.base_url ?? '',
    });
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setForm({
            enabled: provider.enabled,
            client_id: provider.client_id ?? '',
            client_secret: '',
            redirect_uri: provider.redirect_uri ?? '',
            tenant: provider.tenant ?? '',
            base_url: provider.base_url ?? '',
        });
    }, [provider]);

    const save = async () => {
        setSaving(true);
        setMessage(null);
        setError(null);
        try {
            await domainApi.updateOauthSettings(provider.provider, {
                enabled: form.enabled,
                client_id: form.client_id || null,
                client_secret: form.client_secret || undefined,
                redirect_uri: form.redirect_uri || null,
                tenant: form.tenant || null,
                base_url: form.base_url || null,
            });
            await onSaved();
            setMessage('Fournisseur enregistré.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form
            class="rounded-xl border border-base-300/70 p-4"
            onSubmit={(event) => {
                event.preventDefault();
                if (canEdit && !saving) {
                    void save();
                }
            }}
        >
            <HiddenUsernameField />
            <div class="mb-3 flex items-center justify-between gap-2">
                <p class="text-xs sm:text-sm font-semibold capitalize">{provider.provider}</p>
                <StatusBadge label={form.enabled ? 'Activé' : 'Désactivé'} tone={form.enabled ? 'success' : 'neutral'} />
            </div>
            <div class="grid gap-3">
                <ToggleField
                    label="Activé"
                    checked={form.enabled}
                    disabled={!canEdit || saving}
                    onChange={(value) => setForm((current) => ({ ...current, enabled: value }))}
                />
                <Field label="Client ID">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        value={form.client_id}
                        disabled={!canEdit || saving}
                        onInput={(event) => setForm((current) => ({ ...current, client_id: event.currentTarget.value }))}
                    />
                </Field>
                <Field label={`Secret${provider.client_secret_set ? ' (laisser vide pour conserver)' : ''}`}>
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        type="password"
                        value={form.client_secret}
                        disabled={!canEdit || saving}
                        autoComplete="new-password"
                        onInput={(event) => setForm((current) => ({ ...current, client_secret: event.currentTarget.value }))}
                    />
                </Field>
                <Field label="Redirect URI">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        value={form.redirect_uri}
                        disabled={!canEdit || saving}
                        onInput={(event) => setForm((current) => ({ ...current, redirect_uri: event.currentTarget.value }))}
                    />
                </Field>
                <Field label="Tenant">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        value={form.tenant}
                        disabled={!canEdit || saving}
                        onInput={(event) => setForm((current) => ({ ...current, tenant: event.currentTarget.value }))}
                    />
                </Field>
                <Field label="Base URL">
                    <input
                        class="input input-bordered input-sm w-full rounded-xl"
                        value={form.base_url}
                        disabled={!canEdit || saving}
                        onInput={(event) => setForm((current) => ({ ...current, base_url: event.currentTarget.value }))}
                    />
                </Field>
                {error && <p class="text-sm text-error">{error}</p>}
                {message && <p class="text-sm text-base-content/60" role="status">{message}</p>}
                {canEdit && (
                    <button class="btn btn-primary btn-sm w-fit rounded-xl" type="submit" disabled={saving}>
                        <Save class="size-3.5" aria-hidden />
                        {saving ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                )}
            </div>
        </form>
    );
}

export function OauthSettingsPanel({ permissions }: { permissions: BootstrapPermissions; legacyBaseUrl: string }) {
    const oauth = useApiQuery('settings-oauth', () => domainApi.oauthSettings());
    const canEdit = permissions.instance_admin;

    return (
        <div class="grid gap-4">
            <Card title="OAuth" eyebrow={canEdit ? 'Administrateur' : 'Lecture seule'}>
                <div class="card-toolbar mb-3">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void oauth.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </div>
                <DataState loading={oauth.loading} error={oauth.error} onRetry={() => void oauth.reload()}>
                    {oauth.data && (
                        <div class="grid gap-3">
                            {oauth.data.data.length === 0 ? (
                                <p class="text-sm text-base-content/55">Aucun fournisseur OAuth configuré.</p>
                            ) : (
                                oauth.data.data.map((provider) => (
                                    <OauthProviderForm
                                        key={provider.id}
                                        provider={provider}
                                        canEdit={canEdit}
                                        onSaved={oauth.reload}
                                    />
                                ))
                            )}
                        </div>
                    )}
                </DataState>
            </Card>
        </div>
    );
}
