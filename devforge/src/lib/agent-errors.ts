import type { Agent } from './domain-api';

function formatRawError(summary: string): string {
    const lower = summary.toLowerCase();

    if (lower.includes('[503]') || lower.includes('high demand') || lower.includes('surchargé')) {
        return 'Gemini est temporairement surchargé. L\'agent réessaie automatiquement et bascule vers un provider de secours si configuré (ex. Ollama local ou un autre modèle Gemini).';
    }

    if (lower.includes('[429]') || lower.includes('quota') || lower.includes('rate limit')) {
        return 'Quota ou limite de débit Gemini atteint. Réessayez plus tard ou vérifiez votre clé API.';
    }

    if (lower.includes('[400]') && lower.includes('contents')) {
        return 'Erreur de format de requête Gemini. Redéployez la dernière version de DevForge.';
    }

    if (lower.includes('server::status')) {
        return 'Erreur interne lors de la lecture des serveurs. Redéployez la dernière version de DevForge.';
    }

    if (summary.length > 280) {
        return `${summary.slice(0, 277)}…`;
    }

    return summary;
}

export function getAgentErrorMessage(agent: Agent): string | null {
    if (agent.status !== 'error') {
        return null;
    }

    const run = agent.latest_run;

    if (!run || run.status !== 'failed') {
        return null;
    }

    const summary = run.summary?.trim();

    if (summary) {
        const normalized = summary.startsWith('Erreur:') || summary.startsWith('Erreur :')
            ? summary.replace(/^Erreur:\s*/i, '').replace(/^Erreur :\s*/i, '')
            : summary;

        return formatRawError(normalized);
    }

    return 'La dernière exécution a échoué sans message détaillé.';
}

export function hasAgentError(agent: Agent): boolean {
    return getAgentErrorMessage(agent) !== null;
}
