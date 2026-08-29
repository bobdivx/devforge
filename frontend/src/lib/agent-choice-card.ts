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
    catalog?: ChatChoiceOption[];
    searchable?: boolean;
    selected_id?: string;
    dismissed?: boolean;
};

function parseOptions(raw: unknown): ChatChoiceOption[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
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
}

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
    const options = parseOptions(card.options);
    const catalog = parseOptions(card.catalog);
    const searchable = card.searchable === true || catalog.length > 0;

    if (title === '') {
        return null;
    }

    if (options.length < 2 && catalog.length === 0) {
        return null;
    }

    return {
        id: typeof card.id === 'string' ? card.id : 'choice',
        title,
        body: typeof card.body === 'string' ? card.body.trim() : '',
        options: options.length > 0 ? options : catalog.slice(0, 5),
        catalog: catalog.length > 0 ? catalog : undefined,
        searchable,
        selected_id: typeof card.selected_id === 'string' ? card.selected_id : undefined,
        dismissed: card.dismissed === true,
    };
}

export function isOpenChoiceCard(metadata: Record<string, unknown> | null | undefined): boolean {
    const card = parseChoiceCard(metadata);

    return card !== null && !card.dismissed && !card.selected_id;
}

export function filterChoiceOptions(card: ChatChoiceCard, query: string): ChatChoiceOption[] {
    const catalog = card.catalog && card.catalog.length > 0 ? card.catalog : card.options;
    const normalized = query.trim().toLowerCase();
    if (normalized === '') {
        return card.options;
    }

    const startsWith = catalog.filter((option) => option.label.toLowerCase().startsWith(normalized));
    const contains = catalog.filter((option) => {
        const label = option.label.toLowerCase();
        return label.includes(normalized) && !label.startsWith(normalized);
    });

    return [...startsWith, ...contains];
}
