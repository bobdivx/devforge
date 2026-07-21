import { useState, useEffect } from 'preact/hooks';
import { COMMON_CRONS, formatCron } from '../../lib/cron-utils';
import { HelpCircle } from 'lucide-preact';

interface CronInputProps {
    value: string;
    onChange: (value: string) => void;
    id?: string;
    label?: string;
}

export function CronInput({ value, onChange, id, label = 'Fréquence' }: CronInputProps) {
    // Determine initial mode based on whether the value matches a preset
    const presetMatch = COMMON_CRONS.find((c) => c.value === value);
    const [mode, setMode] = useState<'preset' | 'custom'>(presetMatch ? 'preset' : 'custom');
    
    // Derived formatted string for the custom hint
    const [hint, setHint] = useState<string>('');

    useEffect(() => {
        if (mode === 'custom') {
            const formatted = formatCron(value);
            if (formatted === value && value.trim() !== '') {
                setHint('Format cron invalide ou non reconnu');
            } else {
                setHint(formatted);
            }
        }
    }, [value, mode]);

    return (
        <div class="form-control w-full">
            <label class="label" htmlFor={id}>
                <span class="label-text font-semibold">{label}</span>
            </label>
            <div class="flex flex-col gap-2">
                <select
                    id={id}
                    class="select select-bordered select-sm w-full"
                    value={mode === 'preset' ? value : 'custom'}
                    onChange={(e) => {
                        const next = (e.target as HTMLSelectElement).value;
                        if (next === 'custom') {
                            setMode('custom');
                        } else {
                            setMode('preset');
                            onChange(next);
                        }
                    }}
                >
                    {COMMON_CRONS.map((preset) => (
                        <option key={preset.value} value={preset.value}>
                            {preset.label}
                        </option>
                    ))}
                    <option value="custom">Personnalisé (syntaxe Cron)</option>
                </select>

                {mode === 'custom' && (
                    <div class="mt-2 flex flex-col gap-1">
                        <input
                            type="text"
                            class="input input-bordered input-sm w-full font-mono"
                            placeholder="0 0 * * *"
                            value={value}
                            onInput={(e) => onChange((e.target as HTMLInputElement).value)}
                        />
                        <div class="flex items-start gap-1.5 text-xs mt-1 text-base-content/70">
                            <HelpCircle class="size-3.5 shrink-0 mt-0.5" />
                            <span>{hint || 'Saisissez une expression Cron valide'}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
