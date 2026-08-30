import { AlertTriangle } from 'lucide-preact';
import { isModelTooSmallForTools, SMALL_MODEL_TOOLS_WARNING } from '../../lib/llm-models';

export function SmallModelToolsWarning({ model }: { model: string | null | undefined }) {
    if (! isModelTooSmallForTools(model)) {
        return null;
    }

    return (
        <div class="alert alert-warning mt-1 px-2.5 py-2 text-[11px]" role="status">
            <AlertTriangle class="size-3.5 shrink-0" aria-hidden />
            <span>{SMALL_MODEL_TOOLS_WARNING}</span>
        </div>
    );
}
