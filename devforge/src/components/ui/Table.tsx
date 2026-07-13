import type { ComponentChildren } from 'preact';

type TableProps = {
    headers: string[];
    children: ComponentChildren;
    caption?: string;
};

export function Table({ headers, children, caption }: TableProps) {
    return (
        <div class="overflow-x-auto rounded-2xl border border-base-300/70 bg-base-100">
            <table class="table table-sm">
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
