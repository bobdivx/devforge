import { useEffect, useState } from 'preact/hooks';
import { AiProvidersSettings } from '../../components/agents/AiProvidersSettings';
import { AgentsAdvancedSettingsPanel } from '../../components/agents/AgentsAdvancedSettingsPanel';
import { AgentsDiagnosticPanel } from '../../components/agents/AgentsDiagnosticPanel';
import { AgentsMemoryOverviewPanel } from '../../components/agents/AgentsMemoryOverviewPanel';
import { AgentsMcpSettingsPanel } from '../../components/agents/AgentsMcpSettingsPanel';
import { AgentsSettingsShell } from '../../components/agents/AgentsSettingsShell';
import { LayeredInstructionsPanel } from '../../components/agents/LayeredInstructionsPanel';
import { TeamSkillsPanel } from '../../components/agents/TeamSkillsPanel';
import { PageHeader } from '../../components/PageHeader';
import { PinokioStudioManager } from '../../components/agents/PinokioStudioManager';
import { OllamaControlPanel } from '../../components/settings/OllamaControlPanel';
import { Card } from '../../components/ui/Card';
import {
    AGENTS_SETTINGS_SECTIONS,
    parseAgentsSettingsSection,
    type AgentsSettingsSectionId,
} from '../../lib/agents-settings-sections';
import type { BootstrapPermissions } from '../../lib/bootstrap';

export function AgentsSettingsPage({
    permissions,
}: {
    permissions: BootstrapPermissions;
}) {
    const canManageAi = permissions.manage_team || permissions.instance_admin;
    const [section, setSection] = useState<AgentsSettingsSectionId>(() => {
        if (typeof window === 'undefined') {
            return 'providers';
        }
        const url = new URL(window.location.href);
        const hash = url.hash.replace(/^#/, '');
        return parseAgentsSettingsSection(hash || url.searchParams.get('tab'));
    });

    useEffect(() => {
        const onHash = () => setSection(parseAgentsSettingsSection(window.location.hash));
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);

    const selectSection = (id: AgentsSettingsSectionId) => {
        setSection(id);
        const url = new URL(window.location.href);
        url.hash = id;
        window.history.replaceState({}, '', url.toString());
    };

    const meta = AGENTS_SETTINGS_SECTIONS.find((item) => item.id === section);

    return (
        <>
            <PageHeader
                title="Paramètres AI"
                description="Organisation type agent desktop : providers, modèles, contexte, MCP — adapté à DevForge."
            />

            <AgentsSettingsShell active={section} onChange={selectSection}>
                <Card title={meta?.label ?? 'Paramètres'} eyebrow={meta?.description}>
                    {section === 'providers' && <AiProvidersSettings />}
                    {section === 'models' && <OllamaControlPanel canManage={canManageAi} />}
                    {section === 'pinokio' && <PinokioStudioManager canManage={canManageAi} />}
                    {section === 'instructions' && (
                        <div class="grid gap-6">
                            <div>
                                <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/50">
                                    Instructions layered
                                </p>
                                <LayeredInstructionsPanel />
                            </div>
                            <div>
                                <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/50">
                                    Skills équipe
                                </p>
                                <TeamSkillsPanel />
                            </div>
                        </div>
                    )}
                    {section === 'memory' && <AgentsMemoryOverviewPanel />}
                    {section === 'mcp' && <AgentsMcpSettingsPanel canEdit={canManageAi} />}
                    {section === 'diagnostic' && <AgentsDiagnosticPanel />}
                    {section === 'advanced' && <AgentsAdvancedSettingsPanel canEdit={canManageAi} />}
                </Card>
            </AgentsSettingsShell>
        </>
    );
}
