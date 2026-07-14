import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { LegacyEditBanner } from '../components/settings/SettingsPanels';
import type { BootstrapData } from '../lib/bootstrap';

type OnboardingPageProps = {
    bootstrap: BootstrapData;
};

export function OnboardingPage({ bootstrap }: OnboardingPageProps) {
    return (
        <div class="grid gap-5">
            <PageHeader
                title="Configuration initiale"
                description="Assistant de mise en route de votre instance Coolify."
            />
            <LegacyEditBanner
                legacyBaseUrl={bootstrap.migration.legacy_base_url}
                legacyPath="/onboarding"
                description="L’assistant d’onboarding complet est encore servi par Coolify."
            />
            <Card title="Onboarding">
                <p class="text-sm text-base-content/65">
                    {bootstrap.onboarding.required
                        ? 'Votre équipe doit terminer la configuration initiale pour utiliser toutes les fonctionnalités.'
                        : 'Aucune étape d’onboarding en attente pour l’équipe active.'}
                </p>
            </Card>
        </div>
    );
}
