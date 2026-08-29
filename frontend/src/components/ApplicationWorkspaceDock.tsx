import { Braces, MessageSquare, Rocket, FileText, Settings } from 'lucide-preact';
import { applicationDockItems } from '../lib/application-dock';
import type { ApplicationTabId } from '../lib/application-tabs';
import {
    applicationPath,
    extractApplicationUuid,
    parseApplicationTab,
    routeHref,
} from '../lib/routes';

const dockIcons = {
    agents: MessageSquare,
    deployments: Rocket,
    logs: FileText,
    variables: Braces,
    settings: Settings,
} as const;

type ApplicationWorkspaceDockProps = {
    onNavigate: (event: MouseEvent, path: string) => void;
    locationSearch?: string;
};

export function ApplicationWorkspaceDock({ onNavigate, locationSearch }: ApplicationWorkspaceDockProps) {
    const uuid = typeof window === 'undefined' ? null : extractApplicationUuid(window.location.pathname);
    const search = locationSearch ?? (typeof window === 'undefined' ? '' : window.location.search);
    const activeTab: ApplicationTabId = parseApplicationTab(new URLSearchParams(search).get('tab'));

    if (!uuid) {
        return null;
    }

    const activeIndex = applicationDockItems.findIndex((item) => item.id === activeTab);

    return (
        <nav
            class="devforge-workspace-dock"
            aria-label="Espace de travail application"
        >
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
        </nav>
    );
}
