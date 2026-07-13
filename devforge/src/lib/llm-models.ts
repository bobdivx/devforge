export const CUSTOM_MODEL_VALUE = '__custom__';

export type LlmModelOption = {
    id: string;
    label: string;
    description?: string | null;
};

export function modelSelectValue(model: string, availableModels: LlmModelOption[]): string {
    if (! model) {
        return CUSTOM_MODEL_VALUE;
    }

    return availableModels.some((option) => option.id === model) ? model : CUSTOM_MODEL_VALUE;
}
