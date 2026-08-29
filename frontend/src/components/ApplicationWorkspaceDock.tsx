import { Braces, MessageSquare, Rocket, FileText, Settings, Sparkles, type LucideIcon } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { applicationDockItems, type ApplicationDockTabId } from '../lib/application-dock';
import type { ApplicationTabId } from '../lib/application-tabs';
import {
    readSpotlightEnabled,
    SPOTLIGHT_EVENT,
    writeSpotlightEnabled,
    type SpotlightTabEventDetail,
} from '../lib/application-spotlight';
import {
    applicationPath,
    extractApplicationUuid,
    parseApplicationTab,
    routeHref,
} from '../lib/routes';
import { navigateTo } from '../lib/use-navigate';

const dockIcons: Record<ApplicationDockTabId, LucideIcon> = {
    agents: MessageSquare,
    deployments: Rocket,
    logs: FileText,
    variables: Braces,
    settings: Settings,
};

type ApplicationWorkspaceDockProps = {
    onNavigate: (event: MouseEvent, path: string) => void;
    locationSearch?: string;
};

export function ApplicationWorkspaceDock({ onNavigate, locationSearch }: ApplicationWorkspaceDockProps) {
    const uuid = typeof window === 'undefined' ? null : extractApplicationUuid(window.location.pathname);
    const search = locationSearch ?? (typeof window === 'undefined' ? '' : window.location.search);
    const activeTab: ApplicationTabId = parseApplicationTab(new URLSearchParams(search).get('tab'));
    const [spotlightOn, setSpotlightOn] = useState(() => readSpotlightEnabled());

    useEffect(() => {
        const onSpotlight = (event: Event) => {
            const tab = (event as CustomEvent<SpotlightTabEventDetail>).detail?.tab;
            if (!tab || !uuid || !readSpotlightEnabled()) {
                return;
            }

            if (activeTab === tab) {
                return;
            }

            navigateTo(applicationPath(uuid, tab));
        };

        window.addEventListener(SPOTLIGHT_EVENT, onSpotlight);

        return () => window.removeEventListener(SPOTLIGHT_EVENT, onSpotlight);
    }, [uuid, activeTab]);

    if (!uuid) {
        return null;
    }

    const activeIndex = applicationDockItems.findIndex((item) => item.id === activeTab);

    const toggleSpotlight = () => {
        const next = !spotlightOn;
        setSpotlightOn(next);
        writeSpotlightEnabled(next);
    };

    return (
        <nav
            class="devforge-workspace-dock lg:hidden"
            aria-label="Espace de travail application"
        >
            <div class="devforge-workspace-dock__bar">
                <div class="devforge-workspace-dock__inner">
                    {activeIndex >= 0 && (
                        <span
                            class="devforge-workspace-dock__pill"
                            style={{
                                width: `calc((100% - 0.5rem) / ${applicationDockItems.length})`,
                                transform: `translateX(calc(${activeIndex} * 100%))`,
                            }}
                            aria-hidden
                        />
                    )}
                    {applicationDockItems.map((item) => {
                        const Icon = dockIcons[item.id];
                        const href = applicationPath(uuid, item.id);
                        const active = activeTab === item.id;

                        return (
                            <a
                                key={item.id}
                                class={`devforge-workspace-dock__item ${active ? 'is-active' : ''}`}
                                href={routeHref(href)}
                                aria-current={active ? 'page' : undefined}
                                onClick={(event) => onNavigate(event, href)}
                            >
                                <Icon class="size-4" aria-hidden />
                                <span>{item.label}</span>
                            </a>
                        );
                    })}
                </div>
                <button
                    class={`devforge-workspace-dock__spotlight ${spotlightOn ? 'is-on' : ''}`}
                    type="button"
                    aria-pressed={spotlightOn}
                    aria-label={spotlightOn ? 'Désactiver Spotlight' : 'Activer Spotlight'}
                    title="Spotlight : ouvrir Déploiements, Logs ou Env quand l’agent y travaille"
                    onClick={toggleSpotlight}
                >
                    <Sparkles class="size-3.5" aria-hidden />
                    <span>Spotlight</span>
                </button>
            </div>
        </nav>
    );
}
