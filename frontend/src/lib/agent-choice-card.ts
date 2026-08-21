export type ChatChoiceOption = {
    id: string;
    label: string;
    hint?: string;
    prompt: string;
};

export type ChatChoiceCard = {
    id: string;
    title: string;
    body: string;
    options: ChatChoiceOption[];
    selected_id?: string;
    dismissed?: boolean;
};

export function parseChoiceCard(metadata: Record<string, unknown> | null | undefined): ChatChoiceCard | null {
    if (!metadata || typeof metadata !== 'object') {
        return null;
    }

    const raw = metadata.choice_card;
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const card = raw as Record<string, unknown>;
    const title = typeof card.title === 'string' ? card.title.trim() : '';
    const optionsRaw = Array.isArray(card.options) ? card.options : [];
    const options: ChatChoiceOption[] = optionsRaw
        .filter((option): option is Record<string, unknown> => !!option && typeof option === 'object')
        .map((option, index) => {
            const label = typeof option.label === 'string' ? option.label.trim() : '';
            const prompt = typeof option.prompt === 'string' && option.prompt.trim() !== ''
                ? option.prompt.trim()
                : label;

            return {
                id: typeof option.id === 'string' && option.id !== '' ? option.id : String.fromCharCode(65 + index),
                label,
                hint: typeof option.hint === 'string' ? option.hint : undefined,
                prompt,
            };
        })
        .filter((option) => option.label !== '');

    if (title === '' || options.length < 2) {
        return null;
    }

    return {
        id: typeof card.id === 'string' ? card.id : 'choice',
        title,
        body: typeof card.body === 'string' ? card.body.trim() : '',
        options,
        selected_id: typeof card.selected_id === 'string' ? card.selected_id : undefined,
        dismissed: card.dismissed === true,
    };
}

export function isOpenChoiceCard(metadata: Record<string, unknown> | null | undefined): boolean {
    const card = parseChoiceCard(metadata);

    return card !== null && !card.dismissed && !card.selected_id;
}
