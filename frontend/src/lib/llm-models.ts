export const CUSTOM_MODEL_VALUE = '__custom__';

export const AUTO_MODEL_VALUE = 'auto';

export const MIN_AGENT_TOOL_PARAMS_B = 7;

export const SMALL_MODEL_TOOLS_WARNING =
    'Ce modèle est trop petit pour les agents avec outils (MCP). Attendez-vous à des réponses vides ou absurdes ; utilisez au moins un modèle coder 7B (ex. qwen2.5-coder:7b).';

export type LlmModelOption = {
    id: string;
    label: string;
    description?: string | null;
};

export function isAutoModel(model: string | null | undefined): boolean {
    const normalized = (model ?? '').trim().toLowerCase();

    return normalized === '' || normalized === AUTO_MODEL_VALUE;
}

export function formatModelLabel(model: string, modelLabel?: string | null): string {
    if (modelLabel) {
        return modelLabel;
    }

    return isAutoModel(model) ? 'Auto' : model;
}

export function formatProviderModel(provider: string, model: string, modelLabel?: string | null): string {
    return `${provider}/${formatModelLabel(model, modelLabel)}`;
}

/** Affichage agent — Auto + tier si connu depuis le dernier run. */
export function formatAgentProviderDisplay(provider: string, routing?: { display?: string } | null): string {
    if (routing?.display) {
        return `${provider}/${routing.display}`;
    }

    return `${provider}/Auto`;
}

export function modelSelectValue(model: string, availableModels: LlmModelOption[]): string {
    if (isAutoModel(model)) {
        return AUTO_MODEL_VALUE;
    }

    if (! model) {
        return CUSTOM_MODEL_VALUE;
    }

    return availableModels.some((option) => option.id === model) ? model : CUSTOM_MODEL_VALUE;
}

/**
 * Parse billions of parameters from tags like qwen2.5:3b, :1.5b, llama3.2:3b-instruct.
 * Ignores MoE markers such as mixtral:8x7b.
 */
export function parseModelParamBillions(model: string | null | undefined): number | null {
    const id = (model ?? '').trim().toLowerCase();
    if (id === '') {
        return null;
    }

    const matches = [...id.matchAll(/(\d+(?:\.\d+)?)b\b/gi)];
    const values: number[] = [];
    for (const match of matches) {
        const offset = match.index ?? 0;
        if (offset > 0 && id[offset - 1] === 'x') {
            continue;
        }
        values.push(Number.parseFloat(match[1] ?? ''));
    }

    if (values.length === 0) {
        return null;
    }

    return Math.max(...values);
}

export function isModelTooSmallForTools(model: string | null | undefined): boolean {
    const id = (model ?? '').trim().toLowerCase();
    if (id === '' || id === AUTO_MODEL_VALUE) {
        return false;
    }

    if (id.includes('tinyllama') || /(?:^|[:\-_/.])(tiny|mini)(?:[:\-_/.]|$)/i.test(id)) {
        return true;
    }

    const billions = parseModelParamBillions(id);
    if (billions === null) {
        return false;
    }

    return billions < MIN_AGENT_TOOL_PARAMS_B;
}
