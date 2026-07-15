import { useEffect, useRef } from 'preact/hooks';

type Props = {
    logs: string | null | undefined;
    class?: string;
};

export function AgentRunLog({ logs, class: className = '' }: Props) {
    const containerRef = useRef<HTMLPreElement>(null);

    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [logs]);

    if (!logs) {
        return (
            <p class="py-4 text-center text-xs text-base-content/50">Aucun log disponible.</p>
        );
    }

    return (
        <pre
            ref={containerRef}
            class={`w-full max-w-full min-w-0 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-base-300 p-3 text-[11px] leading-relaxed text-base-content/80 ${className}`}
        >
            {logs}
        </pre>
    );
}
