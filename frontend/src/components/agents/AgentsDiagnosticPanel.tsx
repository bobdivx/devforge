import { Activity, AlertTriangle, CheckCircle2, Play, XCircle } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import {
    domainApi,
    type AgentDiagnosticCheck,
    type AgentDiagnosticKind,
    type AgentDiagnosticStatus,
} from '../../lib/domain-api';

type CardState = 'pending' | 'running' | AgentDiagnosticStatus;

type DisplayCard = {
    id: string;
    kind: AgentDiagnosticKind;
    label: string;
    hint?: string;
    state: CardState;
    message?: string;
    detail?: string | null;
    target?: string | null;
    durationMs?: number;
    models?: string[];
};

const STEPS: Array<{ kind: AgentDiagnosticKind; label: string; hint: string }> = [
    { kind: 'rig', label: 'Sidecar Rig', hint: 'GET {agent_url}/health' },
    { kind: 'mcp', label: 'MCP', hint: 'initialize (aucun outil exécuté)' },
    { kind: 'ollama', label: 'Ollama', hint: '/api/tags + smoke /v1/chat/completions (8 tokens)' },
    { kind: 'gemini', label: 'Gemini', hint: 'Liste des modèles — 429 explicite' },
];

const statusRing: Record<CardState, string> = {
    pending: 'border-base-300 bg-base-100',
    running: 'border-info/50 bg-info/5 diag-running',
    ok: 'border-success/40 bg-success/5 diag-card-in',
    warn: 'border-warning/50 bg-warning/5 diag-card-in',
    fail: 'border-error/50 bg-error/5 diag-card-in',
};

function StatusIcon({ state }: { state: CardState }) {
    if (state === 'running') {
        return <span class="loading loading-spinner loading-sm text-info" aria-hidden />;
    }
    if (state === 'ok') {
        return <CheckCircle2 class="size-5 text-success" aria-hidden />;
    }
    if (state === 'warn') {
        return <AlertTriangle class="size-5 text-warning" aria-hidden />;
    }
    if (state === 'fail') {
        return <XCircle class="size-5 text-error" aria-hidden />;
    }
    return <span class="mt-1 size-2.5 rounded-full bg-base-content/25" aria-hidden />;
}

function toCards(checks: AgentDiagnosticCheck[]): DisplayCard[] {
    return checks.map((check) => ({
        id: check.id,
        kind: check.kind,
        label: check.label,
        state: check.status,
        message: check.message,
        detail: check.detail,
        target: check.target,
        durationMs: check.duration_ms,
        models: check.models,
    }));
}

export function AgentsDiagnosticPanel() {
    const [running, setRunning] = useState(false);
    const [cards, setCards] = useState<DisplayCard[]>(() => STEPS.map((step) => ({
        id: `pending-${step.kind}`,
        kind: step.kind,
        label: step.label,
        hint: step.hint,
        state: 'pending',
    })));
    const [error, setError] = useState<string | null>(null);

    const summary = useMemo(() => {
        const done = cards.filter((card) => card.state === 'ok' || card.state === 'warn' || card.state === 'fail');
        if (done.length === 0) {
            return null;
        }
        const ok = done.filter((card) => card.state === 'ok').length;
        const warn = done.filter((card) => card.state === 'warn').length;
        const fail = done.filter((card) => card.state === 'fail').length;
        return { ok, warn, fail, total: done.length };
    }, [cards]);

    const run = async () => {
        setRunning(true);
        setError(null);
        setCards(STEPS.map((step) => ({
            id: `pending-${step.kind}`,
            kind: step.kind,
            label: step.label,
            hint: step.hint,
            state: 'pending',
        })));

        const collected: DisplayCard[] = [];
        try {
            for (const step of STEPS) {
                setCards([
                    ...collected,
                    {
                        id: `running-${step.kind}`,
                        kind: step.kind,
                        label: step.label,
                        hint: step.hint,
                        state: 'running',
                    },
                    ...STEPS.filter((candidate) => !collected.some((card) => card.kind === candidate.kind)
                        && candidate.kind !== step.kind).map((candidate) => ({
                        id: `pending-${candidate.kind}`,
                        kind: candidate.kind,
                        label: candidate.label,
                        hint: candidate.hint,
                        state: 'pending' as const,
                    })),
                ]);

                const payload = await domainApi.runAgentDiagnostics(step.kind);
                collected.push(...toCards(payload.data.checks));
                setCards([
                    ...collected,
                    ...STEPS.filter((candidate) => !collected.some((card) => card.kind === candidate.kind))
                        .map((candidate) => ({
                            id: `pending-${candidate.kind}`,
                            kind: candidate.kind,
                            label: candidate.label,
                            hint: candidate.hint,
                            state: 'pending' as const,
                        })),
                ]);
            }
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Le diagnostic a échoué.');
        } finally {
            setRunning(false);
        }
    };

    return (
        <div class="grid gap-4">
            <style>{`
                @keyframes diag-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
                .diag-card-in { animation: diag-in .35s ease-out; }
                @keyframes diag-scan { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
                .diag-running {
                    background-image: linear-gradient(90deg, transparent, color-mix(in oklab, var(--color-info, #00b4d8) 14%, transparent), transparent);
                    background-size: 200% 100%;
                    animation: diag-scan 1.35s linear infinite;
                }
            `}</style>

            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                    <p class="text-xs text-base-content/60">
                        Vérifie le sidecar Rig, MCP, chaque Ollama et Gemini — sans exposer les clés API.
                        Les tunnels HTTPS (Cloudflare) cassent souvent le chat Ollama.
                    </p>
                    {summary && (
                        <p class="mt-2 text-[11px] text-base-content/55">
                            {summary.ok} OK · {summary.warn} avertissement{summary.warn > 1 ? 's' : ''} · {summary.fail} échec{summary.fail > 1 ? 's' : ''}
                        </p>
                    )}
                </div>
                <button
                    class="btn btn-primary btn-sm gap-2"
                    type="button"
                    disabled={running}
                    onClick={() => void run()}
                >
                    {running ? <span class="loading loading-spinner loading-xs" /> : <Play class="size-3.5" aria-hidden />}
                    Lancer le diagnostic
                </button>
            </div>

            {error && (
                <div class="alert alert-error text-xs">
                    <XCircle class="size-4" aria-hidden />
                    <span>{error}</span>
                </div>
            )}

            <ul class="grid gap-2.5">
                {cards.map((card) => (
                    <li key={card.id} class={`rounded-2xl border px-3 py-3 sm:px-4 ${statusRing[card.state]}`}>
                        <div class="flex items-start gap-3">
                            <div class="mt-0.5 shrink-0">
                                <StatusIcon state={card.state} />
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <p class="text-sm font-medium">{card.label}</p>
                                    {card.target && (
                                        <span class="badge badge-ghost badge-xs font-mono">{card.target}</span>
                                    )}
                                    {typeof card.durationMs === 'number' && card.state !== 'pending' && card.state !== 'running' && (
                                        <span class="text-[11px] text-base-content/45">{card.durationMs} ms</span>
                                    )}
                                </div>
                                <p class="mt-1 text-[12px] leading-snug text-base-content/70">
                                    {card.state === 'pending' && (card.hint ?? 'En attente')}
                                    {card.state === 'running' && 'Analyse en cours…'}
                                    {(card.state === 'ok' || card.state === 'warn' || card.state === 'fail') && card.message}
                                </p>
                                {card.detail && (
                                    <p class="mt-1 font-mono text-[11px] text-base-content/45">{card.detail}</p>
                                )}
                                {card.models && card.models.length > 0 && (
                                    <p class="mt-1 text-[11px] text-base-content/50">
                                        {card.models.slice(0, 6).join(', ')}
                                        {card.models.length > 6 ? '…' : ''}
                                    </p>
                                )}
                            </div>
                            {card.state === 'pending' && (
                                <Activity class="size-4 shrink-0 text-base-content/25" aria-hidden />
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
