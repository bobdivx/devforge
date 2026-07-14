import { Check, Database, LoaderCircle } from 'lucide-preact';
import { ProgressBar } from '../ui/ProgressBar';

export type DatabaseImportPhase =
    | 'upload'
    | 'transfer'
    | 'stopping'
    | 'importing'
    | 'restarting'
    | 'done';

export type DatabaseImportProgress = {
    fileName: string;
    fileSize: number;
    phase: DatabaseImportPhase;
    percent: number;
    format?: 'sql' | 'db';
};

const steps: Array<{ id: DatabaseImportPhase; label: string }> = [
    { id: 'upload', label: 'Envoi du fichier' },
    { id: 'transfer', label: 'Transfert vers le serveur' },
    { id: 'stopping', label: 'Arrêt de la base' },
    { id: 'importing', label: 'Import des données' },
    { id: 'restarting', label: 'Redémarrage de la base' },
];

const phaseOrder: DatabaseImportPhase[] = ['upload', 'transfer', 'stopping', 'importing', 'restarting', 'done'];

function formatBytes(size: number): string {
    if (size <= 0) {
        return '—';
    }

    const units = ['o', 'Ko', 'Mo', 'Go'];
    let value = size;
    let unit = 0;

    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }

    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function stepState(stepId: DatabaseImportPhase, currentPhase: DatabaseImportPhase): 'done' | 'current' | 'pending' {
    const stepIndex = phaseOrder.indexOf(stepId);
    const currentIndex = phaseOrder.indexOf(currentPhase);

    if (currentPhase === 'done' || stepIndex < currentIndex) {
        return 'done';
    }

    if (stepId === currentPhase) {
        return 'current';
    }

    return 'pending';
}

type DatabaseImportProgressCardProps = {
    progress: DatabaseImportProgress;
};

export function DatabaseImportProgressCard({ progress }: DatabaseImportProgressCardProps) {
    const currentStep = steps.find((step) => step.id === progress.phase);
    const tone = progress.phase === 'done' ? 'success' : 'primary';

    return (
        <article
            class="rounded-xl border border-primary/25 bg-primary/5 p-4 shadow-sm"
            role="status"
            aria-live="polite"
            aria-busy={progress.phase !== 'done'}
        >
            <div class="mb-3 flex items-start gap-3">
                <div class="rounded-lg bg-primary/10 p-2 text-primary">
                    {progress.phase === 'done'
                        ? <Check class="size-4" aria-hidden />
                        : <Database class="size-4 animate-pulse" aria-hidden />}
                </div>
                <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold">
                        {progress.phase === 'done' ? 'Import terminé' : 'Importation en cours'}
                    </p>
                    <p class="truncate font-mono text-xs text-base-content/55">{progress.fileName}</p>
                    <p class="text-[11px] text-base-content/45">
                        {formatBytes(progress.fileSize)}
                        {progress.format && (
                            <> · format {progress.format === 'db' ? '.db' : '.sql'}</>
                        )}
                    </p>
                </div>
            </div>

            <ProgressBar
                value={progress.percent}
                label={currentStep?.label ?? 'Progression'}
                tone={tone}
            />

            <ol class="mt-4 grid gap-2">
                {steps.map((step) => {
                    const state = stepState(step.id, progress.phase);

                    return (
                        <li
                            class={`flex items-center gap-2 text-xs ${
                                state === 'pending' ? 'text-base-content/35' : 'text-base-content/75'
                            }`}
                            key={step.id}
                        >
                            {state === 'done' && (
                                <span class="flex size-4 items-center justify-center rounded-full bg-success/15 text-success">
                                    <Check class="size-2.5" aria-hidden />
                                </span>
                            )}
                            {state === 'current' && (
                                <LoaderCircle class="size-4 animate-spin text-primary" aria-hidden />
                            )}
                            {state === 'pending' && (
                                <span class="size-4 rounded-full border border-base-300/80" aria-hidden />
                            )}
                            <span class={state === 'current' ? 'font-medium text-primary' : undefined}>{step.label}</span>
                        </li>
                    );
                })}
            </ol>
        </article>
    );
}
