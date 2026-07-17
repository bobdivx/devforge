import type { Agent, AgentType } from './domain-api';

const PREFERRED_TYPES: AgentType[] = ['deployment', 'devforge', 'debug'];

export function applicationAgentSessionTitle(applicationName: string): string {
    return `App · ${applicationName}`;
}

export function pickApplicationChatAgent(agents: Agent[], applicationUuid: string): Agent | null {
    const eligible = agents.filter((agent) => {
        if (!agent.is_active || !agent.provider) {
            return false;
        }

        if (agent.resource_uuid && agent.resource_uuid !== applicationUuid) {
            return false;
        }

        return true;
    });

    if (eligible.length === 0) {
        return null;
    }

    const scored = eligible.map((agent) => {
        let score = 0;

        const typeIndex = PREFERRED_TYPES.indexOf(agent.type);
        if (typeIndex >= 0) {
            score += (PREFERRED_TYPES.length - typeIndex) * 10;
        }

        if (agent.resource_uuid === applicationUuid) {
            score += 50;
        }

        return { agent, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored[0]?.agent ?? null;
}

export function applicationChatSuggestions(applicationName: string): string[] {
    return [
        `Remplacer l’adapter Vercel par Node (@astrojs/node en mode standalone) pour ${applicationName}`,
        `Diagnostiquer pourquoi ${applicationName} affiche la page nginx par défaut`,
        `Analyser le dernier déploiement de ${applicationName}`,
        `Vérifier le build pack et le Dockerfile / package.json de ${applicationName}`,
    ];
}
