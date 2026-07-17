import { Plug, RefreshCw, Unplug } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type XtermTerminal = import('@xterm/xterm').Terminal;
type XtermFitAddon = import('@xterm/addon-fit').FitAddon;

type TerminalTarget = {
    uuid: string;
    name: string;
    type: string;
};

type TerminalConsoleProps = {
    canAccess: boolean;
    initialServerUuid?: string;
};

async function loadXterm() {
    const [xtermMod, fitMod] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
    ]);
    await import('@xterm/xterm/css/xterm.css');

    const xtermAny = xtermMod as Record<string, unknown>;
    const fitAny = fitMod as Record<string, unknown>;
    const Terminal = (xtermAny.Terminal
        ?? (xtermAny.default as Record<string, unknown> | undefined)?.Terminal
        ?? xtermAny.default) as typeof import('@xterm/xterm').Terminal;
    const FitAddon = (fitAny.FitAddon
        ?? (fitAny.default as Record<string, unknown> | undefined)?.FitAddon
        ?? fitAny.default) as typeof import('@xterm/addon-fit').FitAddon;

    return { Terminal, FitAddon };
}

async function ensureTerminalAuth(endpoint: string): Promise<boolean> {
    const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
        },
    });

    if (!response.ok) {
        return false;
    }

    const payload = await response.json() as { authenticated?: boolean };
    return payload.authenticated === true;
}

export function TerminalConsole({ canAccess, initialServerUuid = '' }: TerminalConsoleProps) {
    const config = useApiQuery(canAccess ? 'terminal-config' : null, () => domainApi.terminalConfig());
    const hostRef = useRef<HTMLDivElement | null>(null);
    const termRef = useRef<XtermTerminal | null>(null);
    const fitRef = useRef<XtermFitAddon | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const [selectedUuid, setSelectedUuid] = useState<string>(initialServerUuid);
    const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
    const [message, setMessage] = useState<string | null>(null);

    const targets = (config.data?.data.targets ?? []) as TerminalTarget[];
    const websocketUrl = config.data?.data.websocket_url ?? '';
    const authEndpoint = config.data?.data.auth?.endpoint ?? '/terminal/auth';

    useEffect(() => {
        if (initialServerUuid) {
            setSelectedUuid(initialServerUuid);
            return;
        }
        if (!selectedUuid && targets.length > 0) {
            setSelectedUuid(targets[0].uuid);
        }
    }, [initialServerUuid, selectedUuid, targets]);

    useEffect(() => {
        return () => {
            socketRef.current?.close();
            termRef.current?.dispose();
            termRef.current = null;
            fitRef.current = null;
            socketRef.current = null;
        };
    }, []);

    const disconnect = () => {
        socketRef.current?.close();
        socketRef.current = null;
        setStatus('idle');
        setMessage('Session fermée.');
    };

    const connect = async () => {
        if (!selectedUuid || !websocketUrl) {
            setMessage('Sélectionnez un serveur et rechargez la configuration.');
            return;
        }

        setStatus('connecting');
        setMessage(null);

        try {
            const authenticated = await ensureTerminalAuth(authEndpoint);
            if (!authenticated) {
                setStatus('error');
                setMessage('Authentification terminal refusée.');
                return;
            }

            const session = await domainApi.createTerminalSession(selectedUuid);
            const sshCommand = session.data.command;

            if (!hostRef.current) {
                setStatus('error');
                setMessage('Conteneur terminal indisponible.');
                return;
            }

            if (!termRef.current) {
                const { Terminal, FitAddon } = await loadXterm();
                const term = new Terminal({
                    convertEol: true,
                    cursorBlink: true,
                    fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: 13,
                    theme: {
                        background: '#0f1419',
                        foreground: '#e7ecf3',
                    },
                });
                const fit = new FitAddon();
                term.loadAddon(fit);
                term.open(hostRef.current);
                fit.fit();
                termRef.current = term;
                fitRef.current = fit;

                term.onData((data) => {
                    if (socketRef.current?.readyState === WebSocket.OPEN) {
                        socketRef.current.send(data);
                    }
                });
            } else {
                termRef.current.reset();
                fitRef.current?.fit();
            }

            socketRef.current?.close();
            const socket = new WebSocket(websocketUrl);
            socketRef.current = socket;

            socket.onopen = () => {
                socket.send(JSON.stringify({ command: sshCommand }));
            };

            socket.onmessage = (event) => {
                if (event.data === 'pong') {
                    return;
                }

                if (event.data === 'pty-ready') {
                    setStatus('connected');
                    setMessage(null);
                    fitRef.current?.fit();
                    termRef.current?.focus();
                    return;
                }

                if (event.data === 'unprocessable' || event.data === 'pty-exited') {
                    setStatus('error');
                    setMessage(event.data === 'pty-exited' ? 'Session terminée.' : 'Connexion refusée.');
                    return;
                }

                termRef.current?.write(typeof event.data === 'string' ? event.data : '');
            };

            socket.onerror = () => {
                setStatus('error');
                setMessage('Erreur WebSocket terminal.');
            };

            socket.onclose = () => {
                setStatus((current) => (current === 'connected' ? 'idle' : current));
            };
        } catch (error) {
            setStatus('error');
            setMessage(error instanceof Error ? error.message : 'Impossible d’ouvrir la session terminal.');
        }
    };

    if (!canAccess) {
        return (
            <Card title="Accès refusé">
                <p class="text-sm text-base-content/65">Votre rôle n’autorise pas l’accès au terminal.</p>
            </Card>
        );
    }

    return (
        <div class="grid gap-4">
            <Card title="Terminal interactif">
                <div class="card-toolbar mb-3 flex flex-wrap gap-2">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void config.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </div>
                <DataState loading={config.loading} error={config.error} onRetry={() => void config.reload()}>
                    <div class="grid gap-3">
                        <label class="grid gap-1 text-xs">
                            <span>Serveur</span>
                            <select
                                class="select select-bordered select-sm w-full max-w-md"
                                value={selectedUuid}
                                disabled={status === 'connecting' || status === 'connected'}
                                onChange={(event) => setSelectedUuid(event.currentTarget.value)}
                            >
                                {targets.length === 0 && <option value="">Aucun serveur terminal</option>}
                                {targets.map((target) => (
                                    <option value={target.uuid} key={target.uuid}>
                                        {target.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <p class="font-mono text-[11px] text-base-content/45">{websocketUrl || 'WebSocket non configuré'}</p>
                        <div class="flex flex-wrap gap-2">
                            {status !== 'connected' ? (
                                <button
                                    class="btn btn-primary btn-sm"
                                    type="button"
                                    disabled={!selectedUuid || status === 'connecting'}
                                    onClick={() => void connect()}
                                >
                                    <Plug class="size-3.5" aria-hidden />
                                    {status === 'connecting' ? 'Connexion…' : 'Connecter'}
                                </button>
                            ) : (
                                <button class="btn btn-ghost btn-sm text-error" type="button" onClick={disconnect}>
                                    <Unplug class="size-3.5" aria-hidden />
                                    Déconnecter
                                </button>
                            )}
                        </div>
                        {message && <p class="text-xs text-warning" role="status">{message}</p>}
                        <div
                            ref={hostRef}
                            class="min-h-[22rem] overflow-hidden rounded-xl border border-base-300/70 bg-[#0f1419] p-2"
                        />
                    </div>
                </DataState>
            </Card>
        </div>
    );
}
