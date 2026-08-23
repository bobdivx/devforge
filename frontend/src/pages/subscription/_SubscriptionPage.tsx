import { ExternalLink } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/ui/Card';
import { DataState } from '../../components/ui/DataState';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { BootstrapData } from '../../lib/bootstrap';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type SubscriptionPageProps = {
    bootstrap: BootstrapData;
};

export function SubscriptionPage({ bootstrap }: SubscriptionPageProps) {
    const query = useApiQuery('subscription', () => domainApi.subscription());
    const data = query.data?.data;
    const cloudEnabled = data?.cloud_enabled ?? bootstrap.cloud.enabled;
    const [portalLoading, setPortalLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const openPortal = async () => {
        setPortalLoading(true);
        setError(null);
        try {
            const response = await domainApi.subscriptionPortal();
            window.location.assign(response.data.url);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Impossible d’ouvrir le portail Stripe.');
            setPortalLoading(false);
        }
    };

    if (!cloudEnabled && !query.loading) {
        return (
            <div class="grid gap-3 sm:gap-4 md:gap-5">
                <PageHeader
                    title="Abonnement"
                    description="Gestion de l’abonnement DevForge Cloud."
                />
                <Card title="Instance auto-hébergée">
                    <p class="text-sm text-base-content/65">
                        Cette instance est auto-hébergée : aucun abonnement cloud n’est requis.
                        Les fonctionnalités PaaS sont disponibles selon les permissions de votre équipe.
                    </p>
                </Card>
            </div>
        );
    }

    return (
        <div class="grid gap-3 sm:gap-4 md:gap-5">
            <PageHeader
                title="Abonnement"
                description="État de votre abonnement DevForge Cloud."
            />
            <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                {data && (
                    <>
                        <Card title="État du compte">
                            <dl class="grid gap-2 sm:gap-3 text-sm">
                                <div class="flex items-center justify-between gap-3">
                                    <dt class="text-base-content/55">Abonnement actif</dt>
                                    <dd>
                                        <StatusBadge
                                            label={data.subscription_active ? 'Actif' : 'Inactif'}
                                            tone={data.subscription_active ? 'success' : 'warning'}
                                        />
                                    </dd>
                                </div>
                                <div class="flex items-center justify-between gap-3">
                                    <dt class="text-base-content/55">Période de grâce</dt>
                                    <dd>
                                        <StatusBadge
                                            label={data.subscription_grace_period ? 'Oui' : 'Non'}
                                            tone={data.subscription_grace_period ? 'warning' : 'neutral'}
                                        />
                                    </dd>
                                </div>
                                <div class="flex items-center justify-between gap-3">
                                    <dt class="text-base-content/55">Client Stripe</dt>
                                    <dd>
                                        <StatusBadge
                                            label={data.stripe_customer_id_set ? 'Configuré' : 'Absent'}
                                            tone={data.stripe_customer_id_set ? 'success' : 'neutral'}
                                        />
                                    </dd>
                                </div>
                            </dl>
                        </Card>

                        <Card title="Facturation" eyebrow="Stripe">
                            {data.is_member ? (
                                <p class="text-sm text-base-content/65">
                                    Seuls les administrateurs et propriétaires d’équipe peuvent gérer la facturation.
                                </p>
                            ) : (
                                <div class="grid gap-3">
                                    <p class="text-sm text-base-content/65">
                                        Gérez le moyen de paiement, les factures et le plan via le portail Stripe.
                                    </p>
                                    {error && <p class="text-sm text-error" role="alert">{error}</p>}
                                    <button
                                        class="btn btn-primary btn-sm w-fit"
                                        type="button"
                                        disabled={portalLoading || !data.stripe_customer_id_set}
                                        onClick={() => void openPortal()}
                                    >
                                        <ExternalLink class="size-3.5" aria-hidden />
                                        {portalLoading ? 'Ouverture…' : 'Ouvrir le portail Stripe'}
                                    </button>
                                    {!data.stripe_customer_id_set && (
                                        <p class="text-xs text-base-content/50">
                                            Aucun client Stripe associé à cette équipe pour le moment.
                                        </p>
                                    )}
                                </div>
                            )}
                        </Card>
                    </>
                )}
            </DataState>
        </div>
    );
}
