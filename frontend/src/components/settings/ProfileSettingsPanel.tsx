import { Save, Shield } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { domainApi, type TwoFactorStatus } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type ProfileSettingsPanelProps = {
    legacyBaseUrl?: string;
    twoFactorEnabled?: boolean;
    forcePasswordReset?: boolean;
};

export function ProfileSettingsPanel({
    twoFactorEnabled = false,
    forcePasswordReset = false,
}: ProfileSettingsPanelProps) {
    const query = useApiQuery('profile', () => domainApi.profile());
    const twoFactorQuery = useApiQuery('profile-two-factor', () => domainApi.twoFactorStatus());
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordSaving, setPasswordSaving] = useState(false);
    const [twoFactorPassword, setTwoFactorPassword] = useState('');
    const [confirmCode, setConfirmCode] = useState('');
    const [twoFactorBusy, setTwoFactorBusy] = useState(false);
    const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
    const [twoFactorMessage, setTwoFactorMessage] = useState<string | null>(null);
    const [setupState, setSetupState] = useState<TwoFactorStatus | null>(null);
    const profile = query.data?.data;
    const twoFactor = setupState ?? twoFactorQuery.data?.data;
    const isTwoFactorOn = twoFactor?.two_factor_enabled || twoFactorEnabled || profile?.two_factor_enabled;
    const pendingSetup = Boolean(twoFactor?.qr_code_svg || (twoFactor && !twoFactor.two_factor_confirmed && twoFactor.setup_key));

    const applyTwoFactorResult = async (result: TwoFactorStatus) => {
        setSetupState(result);
        setTwoFactorMessage(result.message ?? null);
        await Promise.all([query.reload(), twoFactorQuery.reload()]);
    };

    return (
        <div class="grid gap-4">
            {(forcePasswordReset || profile?.force_password_reset) && (
                <div class="alert alert-warning text-sm" role="alert">
                    Vous devez changer votre mot de passe avant de continuer. Utilisez le formulaire ci-dessous.
                </div>
            )}

            <Card title="Informations personnelles">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {profile && (
                        <form
                            class="grid gap-3"
                            onSubmit={async (event) => {
                                event.preventDefault();
                                const form = new FormData(event.currentTarget);
                                setSaving(true);
                                setMessage(null);
                                try {
                                    await domainApi.updateProfile({
                                        name: String(form.get('name') ?? ''),
                                        email: String(form.get('email') ?? ''),
                                    });
                                    await query.reload();
                                    setMessage('Profil enregistré.');
                                } catch {
                                    setMessage('Échec de la mise à jour.');
                                } finally {
                                    setSaving(false);
                                }
                            }}
                        >
                            <div class="grid gap-3 md:grid-cols-2">
                                <label class="grid gap-1.5 text-sm">
                                    <span class="font-medium">Nom</span>
                                    <input class="input input-bordered input-sm w-full rounded-xl" name="name" required defaultValue={profile.name} />
                                </label>
                                <label class="grid gap-1.5 text-sm">
                                    <span class="font-medium">E-mail</span>
                                    <input class="input input-bordered input-sm w-full rounded-xl" name="email" type="email" required defaultValue={profile.email} />
                                </label>
                            </div>
                            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div class="flex flex-wrap gap-2">
                                    <StatusBadge
                                        label={profile.email_verified ? 'E-mail vérifié' : 'E-mail non vérifié'}
                                        tone={profile.email_verified ? 'success' : 'warning'}
                                    />
                                    {isTwoFactorOn && (
                                        <StatusBadge label="2FA activée" tone="success" />
                                    )}
                                </div>
                                <button class="btn btn-primary btn-sm w-full rounded-xl sm:w-fit" type="submit" disabled={saving}>
                                    <Save class="size-3.5" aria-hidden />
                                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                                </button>
                            </div>
                            {message && <p class="text-sm text-base-content/60" role="status">{message}</p>}
                        </form>
                    )}
                </DataState>
            </Card>

            <Card title="Mot de passe">
                <form
                    class="grid gap-3"
                    onSubmit={async (event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        setPasswordSaving(true);
                        setPasswordError(null);
                        setPasswordMessage(null);
                        try {
                            const response = await domainApi.updateProfilePassword({
                                current_password: String(form.get('current_password') ?? ''),
                                password: String(form.get('password') ?? ''),
                                password_confirmation: String(form.get('password_confirmation') ?? ''),
                            });
                            setPasswordMessage(response.data.message);
                            event.currentTarget.reset();
                        } catch (caught) {
                            setPasswordError(caught instanceof Error ? caught.message : 'Échec du changement de mot de passe.');
                        } finally {
                            setPasswordSaving(false);
                        }
                    }}
                >
                    <div class="grid gap-3 md:grid-cols-3">
                        <label class="grid gap-1.5 text-sm">
                            <span class="font-medium">Mot de passe actuel</span>
                            <input class="input input-bordered input-sm w-full rounded-xl" name="current_password" type="password" required autoComplete="current-password" />
                        </label>
                        <label class="grid gap-1.5 text-sm">
                            <span class="font-medium">Nouveau mot de passe</span>
                            <input class="input input-bordered input-sm w-full rounded-xl" name="password" type="password" required autoComplete="new-password" />
                        </label>
                        <label class="grid gap-1.5 text-sm">
                            <span class="font-medium">Confirmation</span>
                            <input class="input input-bordered input-sm w-full rounded-xl" name="password_confirmation" type="password" required autoComplete="new-password" />
                        </label>
                    </div>
                    {passwordError && <p class="text-sm text-error" role="alert">{passwordError}</p>}
                    {passwordMessage && <p class="text-sm text-success" role="status">{passwordMessage}</p>}
                    <button class="btn btn-primary btn-sm w-fit rounded-xl" type="submit" disabled={passwordSaving}>
                        <Save class="size-3.5" aria-hidden />
                        {passwordSaving ? 'Enregistrement…' : 'Changer le mot de passe'}
                    </button>
                </form>
            </Card>

            <Card title="Authentification à deux facteurs" eyebrow="TOTP">
                <DataState loading={twoFactorQuery.loading} error={twoFactorQuery.error} onRetry={() => void twoFactorQuery.reload()}>
                    <div class="grid gap-4">
                        <div class="flex flex-col gap-3 rounded-xl border border-base-300/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div class="grid gap-1">
                                <p class="text-sm font-medium">Statut 2FA</p>
                                <p class="text-xs text-base-content/55">
                                    {isTwoFactorOn
                                        ? 'La 2FA est activée sur votre compte.'
                                        : pendingSetup
                                            ? 'Finalisez la configuration en scannant le QR code.'
                                            : 'Renforcez la sécurité avec une application TOTP.'}
                                </p>
                            </div>
                            <StatusBadge
                                label={isTwoFactorOn ? 'Activée' : pendingSetup ? 'En cours' : 'Désactivée'}
                                tone={isTwoFactorOn ? 'success' : pendingSetup ? 'warning' : 'neutral'}
                            />
                        </div>

                        <label class="grid max-w-sm gap-1.5 text-sm">
                            <span class="font-medium">Mot de passe actuel (requis pour activer / désactiver)</span>
                            <input
                                class="input input-bordered input-sm w-full rounded-xl"
                                type="password"
                                value={twoFactorPassword}
                                onInput={(event) => setTwoFactorPassword(event.currentTarget.value)}
                                autoComplete="current-password"
                            />
                        </label>

                        {pendingSetup && twoFactor && (
                            <div class="grid gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                                {twoFactor.qr_code_svg && (
                                    <div
                                        class="mx-auto w-fit rounded-xl bg-white p-3 [&_svg]:size-40"
                                        // QR SVG from Fortify
                                        dangerouslySetInnerHTML={{ __html: twoFactor.qr_code_svg }}
                                    />
                                )}
                                {twoFactor.setup_key && (
                                    <p class="text-center text-xs text-base-content/60">
                                        Clé manuelle : <code class="font-mono">{twoFactor.setup_key}</code>
                                    </p>
                                )}
                                <label class="grid max-w-xs gap-1.5 text-sm">
                                    <span class="font-medium">Code de confirmation</span>
                                    <input
                                        class="input input-bordered input-sm w-full rounded-xl"
                                        value={confirmCode}
                                        onInput={(event) => setConfirmCode(event.currentTarget.value)}
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                    />
                                </label>
                                <button
                                    class="btn btn-primary btn-sm w-fit"
                                    type="button"
                                    disabled={twoFactorBusy || confirmCode.trim().length < 6}
                                    onClick={() => {
                                        void (async () => {
                                            setTwoFactorBusy(true);
                                            setTwoFactorError(null);
                                            try {
                                                const response = await domainApi.confirmTwoFactor(confirmCode.trim());
                                                await applyTwoFactorResult(response.data);
                                                setConfirmCode('');
                                            } catch (caught) {
                                                setTwoFactorError(caught instanceof Error ? caught.message : 'Code invalide.');
                                            } finally {
                                                setTwoFactorBusy(false);
                                            }
                                        })();
                                    }}
                                >
                                    Confirmer la 2FA
                                </button>
                            </div>
                        )}

                        {twoFactor && twoFactor.recovery_codes.length > 0 && (
                            <div class="rounded-xl border border-base-300/70 p-4">
                                <p class="mb-2 text-sm font-medium">Codes de récupération</p>
                                <ul class="grid gap-1 font-mono text-xs sm:grid-cols-2">
                                    {twoFactor.recovery_codes.map((code) => (
                                        <li key={code}>{code}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {twoFactorError && <p class="text-sm text-error" role="alert">{twoFactorError}</p>}
                        {twoFactorMessage && <p class="text-sm text-success" role="status">{twoFactorMessage}</p>}

                        <div class="flex flex-wrap gap-2">
                            {!isTwoFactorOn && !pendingSetup && (
                                <button
                                    class="btn btn-primary btn-sm"
                                    type="button"
                                    disabled={twoFactorBusy || twoFactorPassword.trim().length === 0}
                                    onClick={() => {
                                        void (async () => {
                                            setTwoFactorBusy(true);
                                            setTwoFactorError(null);
                                            try {
                                                const response = await domainApi.enableTwoFactor(twoFactorPassword);
                                                await applyTwoFactorResult(response.data);
                                            } catch (caught) {
                                                setTwoFactorError(caught instanceof Error ? caught.message : 'Échec de l’activation.');
                                            } finally {
                                                setTwoFactorBusy(false);
                                            }
                                        })();
                                    }}
                                >
                                    <Shield class="size-3.5" aria-hidden />
                                    Activer la 2FA
                                </button>
                            )}
                            {isTwoFactorOn && (
                                <>
                                    <button
                                        class="btn btn-outline btn-sm"
                                        type="button"
                                        disabled={twoFactorBusy || twoFactorPassword.trim().length === 0}
                                        onClick={() => {
                                            void (async () => {
                                                setTwoFactorBusy(true);
                                                setTwoFactorError(null);
                                                try {
                                                    const response = await domainApi.regenerateRecoveryCodes(twoFactorPassword);
                                                    await applyTwoFactorResult(response.data);
                                                } catch (caught) {
                                                    setTwoFactorError(caught instanceof Error ? caught.message : 'Échec de la régénération.');
                                                } finally {
                                                    setTwoFactorBusy(false);
                                                }
                                            })();
                                        }}
                                    >
                                        Régénérer les codes
                                    </button>
                                    <button
                                        class="btn btn-error btn-outline btn-sm"
                                        type="button"
                                        disabled={twoFactorBusy || twoFactorPassword.trim().length === 0}
                                        onClick={() => {
                                            void (async () => {
                                                setTwoFactorBusy(true);
                                                setTwoFactorError(null);
                                                try {
                                                    const response = await domainApi.disableTwoFactor(twoFactorPassword);
                                                    setSetupState(null);
                                                    await applyTwoFactorResult(response.data);
                                                    setTwoFactorPassword('');
                                                } catch (caught) {
                                                    setTwoFactorError(caught instanceof Error ? caught.message : 'Échec de la désactivation.');
                                                } finally {
                                                    setTwoFactorBusy(false);
                                                }
                                            })();
                                        }}
                                    >
                                        Désactiver la 2FA
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </DataState>
            </Card>
        </div>
    );
}
