import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { StatusBadge } from '../components/ui/StatusBadge';
import { LegacyEditBanner } from '../components/settings/SettingsPanels';
import type { BootstrapData } from '../lib/bootstrap';

type SubscriptionPageProps = {
    bootstrap: BootstrapData;
};

export function SubscriptionPage({ bootstrap }: SubscriptionPageProps) {
    const { cloud } = bootstrap;

    if (!cloud.enabled) {
        return (
            <div class="grid gap-5">
                <PageHeader
                    title="Abonnement"
                    description="Gestion de l’abonnement Coolify Cloud."
                />
                <Card title="Instance auto-hébergée">
                    <p class="text-sm text-base-content/65">
                        La gestion d’abonnement est réservée aux instances Coolify Cloud.
                    </p>
                </Card>
            </div>
        );
    }

    return (
        <div class="grid gap-5">
            <PageHeader
                title="Abonnement"
                description="État de votre abonnement Coolify Cloud."
            />
            <LegacyEditBanner
                legacyBaseUrl={bootstrap.migration.legacy_base_url}
                legacyPath="/subscription"
                description="Modifiez votre plan, la quantité de serveurs et les moyens de paiement dans Coolify."
            />
            <Card title="État du compte">
                <dl class="grid gap-3 text-sm">
                    <div class="flex items-center justify-between gap-3">
                        <dt class="text-base-content/55">Abonnement actif</dt>
                        <dd>
                            <StatusBadge
                                label={cloud.subscription_active ? 'Actif' : 'Inactif'}
                                tone={cloud.subscription_active ? 'success' : 'warning'}
                            />
                        </dd>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                        <dt class="text-base-content/55">Période de grâce</dt>
                        <dd>
                            <StatusBadge
                                label={cloud.subscription_grace_period ? 'Oui' : 'Non'}
                                tone={cloud.subscription_grace_period ? 'warning' : 'neutral'}
                            />
                        </dd>
                    </div>
                </dl>
            </Card>
        </div>
    );
}
