import type { ComponentChildren } from 'preact';
import { Monitor, Moon, Sun } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { Card } from '../ui/Card';
import {
    applyAppearance,
    contentWidthClass,
    getAppearancePreferences,
    type AppearancePreferences,
    type PageWidth,
    type ThemePreference,
    type ZoomLevel,
} from '../../lib/appearance';

type AppearanceSettingsPanelProps = {
    onPreferencesChange?: (preferences: AppearancePreferences) => void;
};

function ChoiceButton({
    label,
    selected,
    onClick,
    icon,
}: {
    label: string;
    selected: boolean;
    onClick: () => void;
    icon?: ComponentChildren;
}) {
    return (
        <button
            class={`btn btn-sm ${selected ? 'btn-primary' : 'btn-outline'}`}
            type="button"
            aria-pressed={selected}
            onClick={onClick}
        >
            {icon}
            {label}
        </button>
    );
}

export function AppearanceSettingsPanel({ onPreferencesChange }: AppearanceSettingsPanelProps) {
    const [preferences, setPreferences] = useState<AppearancePreferences>(() => getAppearancePreferences());

    useEffect(() => {
        applyAppearance(preferences);
        onPreferencesChange?.(preferences);
    }, [preferences]);

    const update = (patch: Partial<AppearancePreferences>) => {
        setPreferences((current) => ({ ...current, ...patch }));
    };

    return (
        <div class="grid gap-4">
            <Card title="Thème" eyebrow="Affichage">
                <p class="mb-3 text-sm text-base-content/60">Choisissez l’apparence de DevForge dans ce navigateur.</p>
                <div class="action-toolbar">
                    <ChoiceButton
                        label="Clair"
                        selected={preferences.theme === 'light'}
                        icon={<Sun class="size-3.5" aria-hidden />}
                        onClick={() => update({ theme: 'light' as ThemePreference })}
                    />
                    <ChoiceButton
                        label="Système"
                        selected={preferences.theme === 'system'}
                        icon={<Monitor class="size-3.5" aria-hidden />}
                        onClick={() => update({ theme: 'system' })}
                    />
                    <ChoiceButton
                        label="Sombre"
                        selected={preferences.theme === 'dark'}
                        icon={<Moon class="size-3.5" aria-hidden />}
                        onClick={() => update({ theme: 'dark' as ThemePreference })}
                    />
                </div>
            </Card>

            <Card title="Largeur du contenu">
                <p class="mb-3 text-sm text-base-content/60">Limite la largeur des pages pour une lecture plus confortable.</p>
                <div class="action-toolbar">
                    <ChoiceButton
                        label="Centré"
                        selected={preferences.pageWidth === 'center'}
                        onClick={() => update({ pageWidth: 'center' as PageWidth })}
                    />
                    <ChoiceButton
                        label="Pleine largeur"
                        selected={preferences.pageWidth === 'full'}
                        onClick={() => update({ pageWidth: 'full' as PageWidth })}
                    />
                </div>
                <p class="mt-3 text-xs text-base-content/45">
                    Aperçu actuel : <code class="text-xs">{contentWidthClass(preferences.pageWidth)}</code>
                </p>
            </Card>

            <Card title="Densité">
                <p class="mb-3 text-sm text-base-content/60">Réduit légèrement la taille de l’interface.</p>
                <div class="action-toolbar">
                    <ChoiceButton
                        label="100 %"
                        selected={preferences.zoom === '100'}
                        onClick={() => update({ zoom: '100' as ZoomLevel })}
                    />
                    <ChoiceButton
                        label="90 %"
                        selected={preferences.zoom === '90'}
                        onClick={() => update({ zoom: '90' as ZoomLevel })}
                    />
                </div>
            </Card>
        </div>
    );
}
