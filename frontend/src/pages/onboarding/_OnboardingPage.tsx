import { CheckCircle2, Circle, Server, Users } from 'lucide-preact';
import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { BootstrapData } from '../../lib/bootstrap';
import { navigateTo } from '../../lib/use-navigate';

type OnboardingPageProps = {
    bootstrap: BootstrapData;
};

type Step = {
    id: string;
    title: string;
    description: string;
    done: boolean;
    href: string;
    icon: typeof Server;
};

export function OnboardingPage({ bootstrap }: OnboardingPageProps) {
    const hasTeam = bootstrap.teams.length > 0;
    const canCreate = bootstrap.permissions.create_resources;
    const required = bootstrap.onboarding.required;

    const steps: Step[] = [
        {
            id: 'team',
            title: 'Équipe active',
            description: 'Confirmez l’équipe avec laquelle vous travaillez.',
            done: hasTeam,
            href: '/settings/team',
            icon: Users,
        },
        {
            id: 'server',
            title: 'Premier serveur',
            description: 'Ajoutez un hôte Docker joignable en SSH.',
            done: !required,
            href: '/settings/servers',
            icon: Server,
        },
        {
            id: 'resources',
            title: 'Déployer une ressource',
            description: 'Créez une application, une base ou un service.',
            done: !required && canCreate,
            href: '/applications',
            icon: CheckCircle2,
        },
    ];

    return (
        <div class="grid gap-5">
            <PageHeader
                title="Configuration initiale"
                description="Parcours DevForge pour démarrer votre instance."
            />
            <Card title="État">
                <div class="flex flex-wrap items-center gap-3">
                    <StatusBadge
                        label={required ? 'Onboarding requis' : 'Prêt'}
                        tone={required ? 'warning' : 'success'}
                    />
                    <p class="text-sm text-base-content/65">
                        {required
                            ? 'Terminez les étapes ci-dessous pour débloquer l’équipe.'
                            : 'Aucune étape bloquante pour l’équipe active.'}
                    </p>
                </div>
            </Card>
            <div class="grid gap-3">
                {steps.map((step, index) => {
                    const Icon = step.done ? CheckCircle2 : Circle;
                    return (
                        <button
                            class="rounded-2xl border border-base-300/70 bg-base-100 p-4 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md"
                            type="button"
                            key={step.id}
                            onClick={() => navigateTo(step.href)}
                        >
                            <div class="flex items-start gap-3">
                                <Icon class={`mt-0.5 size-5 ${step.done ? 'text-success' : 'text-base-content/35'}`} aria-hidden />
                                <div class="min-w-0 flex-1">
                                    <p class="text-sm font-semibold">
                                        {index + 1}. {step.title}
                                    </p>
                                    <p class="mt-1 text-xs text-base-content/55">{step.description}</p>
                                </div>
                                <StatusBadge label={step.done ? 'Fait' : 'À faire'} tone={step.done ? 'success' : 'neutral'} />
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
