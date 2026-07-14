export const CUSTOM_MODEL_VALUE = '__custom__';

export const AUTO_MODEL_VALUE = 'auto';

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
