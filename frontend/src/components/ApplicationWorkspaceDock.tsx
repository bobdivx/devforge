import { Braces, MessageSquare, Rocket, FileText, Settings } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { applicationDockItems } from '../lib/application-dock';
import type { ApplicationTabId } from '../lib/application-tabs';
import {
    applicationPath,
    extractApplicationUuid,
    readApplicationTabFromLocation,
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
};

export function ApplicationWorkspaceDock({ onNavigate }: ApplicationWorkspaceDockProps) {
    const [uuid, setUuid] = useState(() => (
        typeof window === 'undefined' ? null : extractApplicationUuid(window.location.pathname)
    ));
    const [activeTab, setActiveTab] = useState<ApplicationTabId>(() => readApplicationTabFromLocation());

    useEffect(() => {
        const sync = () => {
            setUuid(extractApplicationUuid(window.location.pathname));
            setActiveTab(readApplicationTabFromLocation());
        };

        window.addEventListener('popstate', sync);

        return () => window.removeEventListener('popstate', sync);
    }, []);

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
