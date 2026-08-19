export const STORE_CATEGORIES = [
    { id: 'web', label: 'Web' },
    { id: 'api', label: 'API' },
    { id: 'cms', label: 'CMS' },
    { id: 'ecommerce', label: 'E-commerce' },
    { id: 'ai', label: 'IA' },
    { id: 'devops', label: 'DevOps' },
    { id: 'other', label: 'Autre' },
] as const;

export function storeCategoryLabel(category: string | null | undefined): string {
    return STORE_CATEGORIES.find((item) => item.id === category)?.label ?? 'Autre';
}
