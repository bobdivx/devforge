import { ChevronRight } from 'lucide-preact';

export type BreadcrumbItem = {
    label: string;
    href?: string;
};

type BreadcrumbsProps = {
    items: BreadcrumbItem[];
    onNavigate?: (event: MouseEvent, path: string) => void;
};

export function Breadcrumbs({ items, onNavigate }: BreadcrumbsProps) {
    return (
        <nav aria-label="Fil d’Ariane" class="flex flex-wrap items-center gap-1 text-xs text-base-content/55">
            {items.map((item, index) => (
                <span class="inline-flex items-center gap-1" key={`${item.label}-${index}`}>
                    {index > 0 && <ChevronRight class="size-3" aria-hidden />}
                    {item.href && onNavigate ? (
                        <a class="hover:text-primary" href={item.href} onClick={(event) => onNavigate(event, item.href!)}>
                            {item.label}
                        </a>
                    ) : (
                        <span class={index === items.length - 1 ? 'font-medium text-base-content' : ''}>{item.label}</span>
                    )}
                </span>
            ))}
        </nav>
    );
}
