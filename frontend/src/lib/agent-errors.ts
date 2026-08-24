import type { Agent } from './domain-api';

function formatRawError(summary: string): string {
    const lower = summary.toLowerCase();

    if (lower.includes('[503]') || lower.includes('high demand') || lower.includes('surchargé')) {
        return 'Gemini est temporairement surchargé. L\'agent réessaie automatiquement et bascule vers un provider de secours si configuré (ex. Ollama local ou un autre modèle Gemini).';
    }

    if (lower.includes('does not support tools') || lower.includes('codegemma')) {
        return 'Le modèle Ollama choisi ne supporte pas les outils (ex. codegemma). En mode Auto, DevForge privilégie llama3.2 ou qwen2.5.';
    }

    if (lower.includes("can't find closing '}' symbol") || lower.includes('closing \'}\' symbol')) {
        return 'Erreur de format multi-tours Ollama (arguments d\'outils). Redéployez DevForge et relancez l\'agent.';
    }

    if (lower.includes('undefined array key') && lower.includes('uuid')) {
        return 'Erreur interne lors d\'un appel d\'outil sans identifiant — corrigée dans la dernière version DevForge. Relancez l\'agent.';
    }

    if (lower.includes('[400]') && lower.includes('ollama')) {
        return 'Requête Ollama refusée. Vérifiez que le modèle supporte les outils (llama3.2, qwen2.5) sur votre instance Ollama.';
    }

    if (lower.includes('[429]') || lower.includes('quota') || lower.includes('rate limit')) {
        return 'Limite de débit ou quota Gemini atteint (429). L\'agent réessaie et bascule automatiquement sur un provider de secours si configuré (OpenRouter, OpenAI, Ollama).';
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
