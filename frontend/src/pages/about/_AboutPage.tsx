import { ArrowUpRight } from 'lucide-preact';
import { PageHeader } from '../../components/PageHeader';

type Credit = {
    name: string;
    role: string;
    blurb: string;
    href: string;
};

const RIG: Credit[] = [
    {
        name: 'Rig',
        role: 'Runtime',
        blurb: 'Runtime Rust des agents DevForge (sidecar devforge-agent). C’est le moteur : chat, tools MCP, providers LLM depuis l’UX.',
        href: 'https://rig.rs',
    },
    {
        name: 'Chat & tools MCP',
        role: 'Sidecar',
        blurb: 'Le sidecar devforge-agent s’appuie sur Rig pour le chat et les tools MCP — tours, outils et contexte, dans le runtime agent.',
        href: 'https://rig.rs',
    },
    {
        name: 'LLM depuis l’UX',
        role: 'Providers',
        blurb: 'Les providers LLM se choisissent dans l’interface DevForge ; Rig les branche dans le runtime des agents.',
        href: 'https://rig.rs',
    },
];

const BASES: Credit[] = [
    {
        name: 'Coolify',
        role: 'Origine',
        blurb: 'Plateforme de déploiements self-host dont DevForge est issu. On n’en dépend plus, le produit a pris son propre chemin.',
        href: 'https://coolify.io',
    },
    {
        name: 'Laravel',
        role: 'Backend',
        blurb: 'API, auth, jobs, SSH et orchestration des déploiements.',
        href: 'https://laravel.com',
    },
    {
        name: 'Traefik',
        role: 'Proxy',
        blurb: 'Reverse proxy des apps déployées (labels, TLS, domaines).',
        href: 'https://traefik.io',
    },
    {
        name: 'Preact + Astro',
        role: 'UI',
        blurb: 'Interface DevForge : pages, chat agents, store.',
        href: 'https://preactjs.com',
    },
    {
        name: 'Ollama',
        role: 'LLM local',
        blurb: 'Provider OpenAI-compatible pour faire tourner les agents sur un GPU du LAN, sans cloud.',
        href: 'https://ollama.com',
    },
];

const PARTNERS: Credit[] = [
    {
        name: 'IceWhale / ZimaOS',
        role: 'NAS',
        blurb: 'OS du ZimaCube. DevForge s’installe comme une app ZimaOS, chemins et secrets conservés.',
        href: 'https://www.zimaspace.com',
    },
    {
        name: 'CasaOS',
        role: 'App store',
        blurb: 'Catalogue d’apps self-host. Le YAML DevForge y est listable (Big Bear / store Briseteia).',
        href: 'https://casaos.io',
    },
    {
        name: 'Big Bear CasaOS',
        role: 'Store communautaire',
        blurb: 'Store CasaOS où DevForge, SONOZZ et Popcornn sont proposés à l’install.',
        href: 'https://community-scripts.github.io/big-bear-casaos/',
    },
];

function CreditCard({ item }: { item: Credit }) {
    return (
        <a
            class="group min-w-0 rounded-2xl border border-base-300/70 bg-base-100 p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md"
            href={item.href}
            target="_blank"
            rel="noreferrer noopener"
        >
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/40">{item.role}</p>
                    <h3 class="mt-1 text-base font-semibold tracking-tight">{item.name}</h3>
                </div>
                <ArrowUpRight class="size-4 shrink-0 text-base-content/35 transition group-hover:text-primary" aria-hidden />
            </div>
            <p class="mt-3 text-sm leading-relaxed text-base-content/60">{item.blurb}</p>
        </a>
    );
}

export function AboutPage() {
    return (
        <>
            <PageHeader
                eyebrow="DevForge"
                title="À propos"
                description="DevForge déploie tes apps, les corrige avec des agents, et continue à les développer. Voici le runtime des agents, les bases du stack, et les partenaires d’install."
            />
            <section class="mb-8 grid gap-3">
                <h2 class="text-sm font-semibold uppercase tracking-[0.16em] text-base-content/45">Rig</h2>
                <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {RIG.map((item) => (
                        <CreditCard key={item.name} item={item} />
                    ))}
                </div>
            </section>
            <section class="mb-8 grid gap-3">
                <h2 class="text-sm font-semibold uppercase tracking-[0.16em] text-base-content/45">Bases</h2>
                <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {BASES.map((item) => (
                        <CreditCard key={item.name} item={item} />
                    ))}
                </div>
            </section>
            <section class="grid gap-3">
                <h2 class="text-sm font-semibold uppercase tracking-[0.16em] text-base-content/45">Partenaires</h2>
                <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {PARTNERS.map((item) => (
                        <CreditCard key={item.name} item={item} />
                    ))}
                </div>
            </section>
        </>
    );
}
