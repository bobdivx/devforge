import { AppearanceSettingsPanel } from '../components/settings/AppearanceSettingsPanel';
import { PageHeader } from '../components/PageHeader';
import { ProfileNav } from '../components/settings/ProfileNav';
import { ProfileSettingsPanel } from '../components/settings/ProfileSettingsPanel';
import type { BootstrapUser } from '../lib/bootstrap';
import { parseProfileTab } from '../lib/profile-tabs';

type ProfilePageProps = {
    path: string;
    user: BootstrapUser;
    legacyBaseUrl?: string;
};

export function ProfilePage({ path, user, legacyBaseUrl = '' }: ProfilePageProps) {
    const activeTab = parseProfileTab(path);

    return (
        <div class="grid gap-5">
            <PageHeader
                title={activeTab === 'appearance' ? 'Apparence' : 'Profil'}
                description="Compte utilisateur et préférences personnelles DevForge."
            />
            <ProfileNav activeTab={activeTab} />
            {activeTab === 'appearance' ? (
                <AppearanceSettingsPanel />
            ) : (
                <ProfileSettingsPanel
                    legacyBaseUrl={legacyBaseUrl}
                    twoFactorEnabled={user.two_factor_enabled}
                    forcePasswordReset={user.force_password_reset}
                />
            )}
        </div>
    );
}
