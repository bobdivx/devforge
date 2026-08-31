export type AgentsSettingsSectionId =
    | 'providers'
    | 'models'
    | 'pinokio'
    | 'instructions'
    | 'memory'
    | 'mcp'
    | 'diagnostic'
    | 'advanced';

export type AgentsSettingsSection = {
    id: AgentsSettingsSectionId;
    label: string;
    description: string;
    group: 'core' | 'data' | 'system';
};

export const AGENTS_SETTINGS_SECTIONS: AgentsSettingsSection[] = [
    {
        id: 'providers',
        label: 'Providers & clés',
        description: 'API keys et connexions LLM',
        group: 'core',
    },
    {
        id: 'models',
        label: 'Modèles locaux',
        description: 'Ollama, pull, GPU NAS',
        group: 'core',
    },
    {
        id: 'pinokio',
        label: 'Demeter / Pinokio',
        description: 'URL studio, VRAM, GGUF',
        group: 'core',
    },
    {
        id: 'instructions',
        label: 'Instructions & Skills',
        description: 'Couches org/perso/projet et procédures',
        group: 'data',
    },
    {
        id: 'memory',
        label: 'Mémoire & contexte',
        description: 'Faits persistants agent / équipe / projet',
        group: 'data',
    },
    {
        id: 'mcp',
        label: 'MCP',
        description: 'Serveurs MCP distants pour les agents',
        group: 'data',
    },
    {
        id: 'diagnostic',
        label: 'Diagnostic',
        description: 'Santé Rig, MCP, Ollama, Gemini',
        group: 'system',
    },
    {
        id: 'advanced',
        label: 'Avancé',
        description: 'Sandbox, collab, rôles dynamiques',
        group: 'system',
    },
];

export function parseAgentsSettingsSection(raw: string | null | undefined): AgentsSettingsSectionId {
    const value = (raw ?? '').replace(/^#/, '').trim().toLowerCase();
    if (AGENTS_SETTINGS_SECTIONS.some((section) => section.id === value)) {
        return value as AgentsSettingsSectionId;
    }

    return 'providers';
}
