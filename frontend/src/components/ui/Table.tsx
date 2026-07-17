import type { ComponentChildren } from 'preact';

type TableProps = {
    headers: string[];
    children: ComponentChildren;
    caption?: string;
    embedded?: boolean;
};

export function Table({ headers, children, caption, embedded = false }: TableProps) {
    return (
        <div class={`min-w-0 max-w-full overflow-x-auto ${embedded ? '' : 'rounded-2xl border border-base-300/70 bg-base-100'}`}>
            <table class="table table-sm w-full">
                {caption && <caption class="sr-only">{caption}</caption>}
                <thead>
                    <tr>
                        {headers.map((header) => <th key={header}>{header}</th>)}
                    </tr>
                </thead>
                <tbody>{children}</tbody>
            </table>
        </div>
    );
}
