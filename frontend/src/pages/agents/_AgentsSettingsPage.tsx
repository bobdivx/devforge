import { AiProvidersSettings } from '../../components/agents/AiProvidersSettings';
import { LayeredInstructionsPanel } from '../../components/agents/LayeredInstructionsPanel';
import { PageHeader } from '../../components/PageHeader';
import { OllamaControlPanel } from '../../components/settings/OllamaControlPanel';
import { Card } from '../../components/ui/Card';
import type { BootstrapPermissions } from '../../lib/bootstrap';

export function AgentsSettingsPage({
    permissions,
}: {
    permissions: BootstrapPermissions;
}) {
    const canManageAi = permissions.manage_team || permissions.instance_admin;

    return (
        <>
            <PageHeader
                title="Paramètres AI"
                description="Providers LLM, Ollama et instructions partagées pour vos agents."
            />

            <div class="grid gap-4">
                <Card title="Intelligence Artificielle" eyebrow="Providers LLM">
                    <AiProvidersSettings />
                </Card>
                <Card title="Ollama" eyebrow="Modèles locaux · GPU">
                    <OllamaControlPanel canManage={canManageAi} />
                </Card>
                <Card title="Instructions agents" eyebrow="Couches org / perso / projet">
                    <LayeredInstructionsPanel />
                </Card>
            </div>
        </>
    );
}
