import { Save } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { LegacyEditBanner } from '../migration/LegacyEditBanner';
import { domainApi } from '../../lib/domain-api';
import { legacyCoolifyUrl } from '../../lib/migration';
import { useApiQuery } from '../../lib/use-api-query';

type ProfileSettingsPanelProps = {
    legacyBaseUrl: string;
    twoFactorEnabled?: boolean;
    forcePasswordReset?: boolean;
};

export function ProfileSettingsPanel({
    legacyBaseUrl,
    twoFactorEnabled = false,
    forcePasswordReset = false,
}: ProfileSettingsPanelProps) {
    const query = useApiQuery('profile', () => domainApi.profile());
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const profile = query.data?.data;

    return (
        <div class="grid gap-4">
            {forcePasswordReset && (
                <div class="alert alert-warning text-sm" role="alert">
                    Vous devez changer votre mot de passe avant de continuer.
                    <a class="link ms-1" href={legacyCoolifyUrl(legacyBaseUrl, '/profile')}>Configurer dans DevForge</a>
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
                                    {profile.two_factor_enabled && (
                                        <StatusBadge label="2FA activée" tone="success" />
                                    )}
                                </div>
                                <button class="btn btn-primary btn-sm w-full rounded-xl sm:w-fit" type="submit" disabled={saving}>
                                    <Save class="size-3.5" aria-hidden />
                                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                                </button>
                            </div>
                            {message && <p class="text-sm text-base-content/60" role="status">{message}</p>}
                            <p class="text-xs text-base-content/45">
                                Le changement d’e-mail avec vérification reste disponible dans Coolify si votre instance l’exige.
                            </p>
                        </form>
                    )}
                </DataState>
            </Card>

            <Card title="Sécurité du compte" eyebrow="Mot de passe & 2FA">
                <div class="grid gap-3">
                    <div class="flex flex-col gap-3 rounded-xl border border-base-300/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div class="grid gap-1">
                            <p class="text-sm font-medium">Authentification à deux facteurs</p>
                            <p class="text-xs text-base-content/55">
                                {twoFactorEnabled || profile?.two_factor_enabled
                                    ? 'La 2FA est activée sur votre compte.'
                                    : 'Renforcez la sécurité de votre compte avec une application TOTP.'}
                            </p>
                        </div>
                        <StatusBadge
                            label={twoFactorEnabled || profile?.two_factor_enabled ? 'Activée' : 'Désactivée'}
                            tone={twoFactorEnabled || profile?.two_factor_enabled ? 'success' : 'neutral'}
                        />
                    </div>
                    <div class="col-span-full">
                        <LegacyEditBanner
                            title="Mot de passe et configuration 2FA"
                            description="La modification du mot de passe et l’activation TOTP seront bientôt ajoutées dans DevForge."
                        />
                    </div>
                </div>
            </Card>
        </div>
    );
}
