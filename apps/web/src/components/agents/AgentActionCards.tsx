import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AgentPlan, AgentToolCall } from '../../lib/agent-stream';
import { cn } from '../../lib/cn';
import { Button, PulseDot, Spinner } from '../ui';

export type LiveAction = AgentToolCall & { status: 'running' | 'ok' | 'fail' };

const SHELL_TOOLS = new Set([
  'start_local_preview',
  'run_application_tests',
  'get_deployment_logs',
  'http_smoke',
  'trigger_deploy',
  'mcp_call_tool',
  'publish_to_github',
  'sync_workdir_to_github',
  'create_github_fix',
  'create_github_repo',
]);

const READ_TOOLS = new Set([
  'read_project_file',
  'read_github_file',
  'list_project_files',
  'get_project',
  'list_projects',
  'list_env_vars',
  'github_list_prs',
  'github_workflow_runs',
  'mcp_list_servers',
  'mcp_list_remote_tools',
]);

function strArg(call: AgentToolCall, key: string): string {
  const v = call.arguments?.[key];
  return typeof v === 'string' ? v : '';
}

function langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'ts',
    tsx: 'ts',
    js: 'js',
    jsx: 'js',
    astro: 'astro',
    rs: 'rs',
    json: 'json',
    md: 'md',
    css: 'css',
    html: 'html',
    yml: 'yml',
    yaml: 'yml',
    toml: 'toml',
    sh: 'sh',
  };
  return map[ext] || ext || 'file';
}

function lineCount(content: string): number {
  if (!content) return 0;
  return content.split('\n').length;
}

function previewLines(content: string, max = 10): { text: string; more: number } {
  const lines = content.split('\n');
  if (lines.length <= max) return { text: content, more: 0 };
  return { text: lines.slice(0, max).join('\n'), more: lines.length - max };
}

function resultText(call: AgentToolCall): string {
  const r = call.result;
  if (!r) return '';
  if (typeof r.message === 'string' && r.message.trim()) return r.message;
  if (typeof r.error === 'string') return r.error;
  if (typeof r.content === 'string') return r.content;
  if (typeof r.logs === 'string') return r.logs;
  if (typeof r.output === 'string') return r.output;
  if (typeof r.hint === 'string') return r.hint;
  try {
    return JSON.stringify(r, null, 2);
  } catch {
    return '';
  }
}

function filePath(call: AgentToolCall): string {
  return (
    strArg(call, 'path') ||
    (typeof call.result?.path === 'string' ? call.result.path : '') ||
    ''
  );
}

function kindOf(call: AgentToolCall): 'file' | 'shell' | 'read' | 'plan' | 'generic' {
  if (call.name === 'propose_plan') return 'plan';
  if (call.name === 'write_project_file') return 'file';
  if (SHELL_TOOLS.has(call.name)) return 'shell';
  if (READ_TOOLS.has(call.name)) return 'read';
  return 'generic';
}

function headerLabel(call: AgentToolCall): string {
  const kind = kindOf(call);
  if (kind === 'file') {
    const path = filePath(call) || 'fichier';
    const content = strArg(call, 'content');
    const n = lineCount(content);
    const lang = langFromPath(path);
    const base = path.split('/').pop() || path;
    return n > 0 ? `${lang} ${base} +${n}` : `${lang} ${base}`;
  }
  if (kind === 'shell') {
    if (call.name === 'start_local_preview') {
      const cmd =
        strArg(call, 'command') ||
        (typeof call.result?.command === 'string' ? call.result.command : 'preview');
      return cmd;
    }
    if (call.name === 'run_application_tests') return 'tests';
    if (call.name === 'get_deployment_logs') return 'logs de déploiement';
    if (call.name === 'http_smoke') return 'smoke HTTP';
    if (call.name === 'mcp_call_tool') return strArg(call, 'tool') || 'mcp';
    return call.name.replace(/_/g, ' ');
  }
  if (kind === 'read') {
    const path = filePath(call);
    if (path) return path;
    return call.name.replace(/_/g, ' ');
  }
  if (kind === 'plan') {
    const title =
      (call.result?.plan && typeof call.result.plan.title === 'string'
        ? call.result.plan.title
        : strArg(call, 'title')) || 'Plan';
    return title;
  }
  return call.name.replace(/_/g, ' ');
}

function ActionIcon({ kind, status }: { kind: ReturnType<typeof kindOf>; status: LiveAction['status'] }) {
  if (status === 'running') return <Spinner class="h-3.5 w-3.5 shrink-0" />;
  if (kind === 'shell') {
    return <span class="w-4 shrink-0 text-center font-mono text-[11px] text-[var(--color-ink-faint)]">&gt;_</span>;
  }
  if (kind === 'file') {
    return <span class="w-4 shrink-0 text-center text-[11px] text-[var(--color-ink-faint)]">⌘</span>;
  }
  if (kind === 'plan') {
    return <span class="w-4 shrink-0 text-center text-[11px] text-[var(--color-ink-faint)]">☰</span>;
  }
  return <span class="w-4 shrink-0 text-center text-[11px] text-[var(--color-ink-faint)]">·</span>;
}

export function AgentActionCard({
  call,
  defaultOpen,
}: {
  call: LiveAction;
  defaultOpen?: boolean;
}) {
  const kind = kindOf(call);
  const [open, setOpen] = useState(Boolean(defaultOpen) || call.status === 'running');
  const ok = call.status !== 'fail' && call.result?.ok !== false;
  const label = headerLabel(call);

  useEffect(() => {
    if (call.status === 'running') setOpen(true);
  }, [call.status]);

  const body = useMemo(() => {
    if (kind === 'file') {
      const content = strArg(call, 'content');
      if (!content) {
        return (
          <p class="px-3 py-2 text-xs text-[var(--color-ink-muted)]">
            {typeof call.result?.message === 'string' ? call.result.message : 'Fichier écrit.'}
          </p>
        );
      }
      const preview = previewLines(content);
      return (
        <pre class="overflow-x-auto bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
          {preview.text.split('\n').map((line, i) => (
            <div key={i} class="flex gap-3">
              <span class="w-6 shrink-0 select-none text-right text-[var(--color-ink-faint)]">
                {i + 1}
              </span>
              <span class="whitespace-pre text-emerald-300/90">+ {line || ' '}</span>
            </div>
          ))}
          {preview.more > 0 && (
            <div class="mt-1 text-[var(--color-ink-faint)]">… {preview.more} lignes de plus</div>
          )}
        </pre>
      );
    }
    if (kind === 'plan') {
      const steps = Array.isArray(call.arguments?.steps)
        ? (call.arguments?.steps as unknown[]).map(String)
        : call.result?.plan?.steps ?? [];
      const summary =
        strArg(call, 'summary') ||
        (typeof call.result?.plan?.summary === 'string' ? call.result.plan.summary : '');
      return (
        <div class="px-3 py-2 text-sm">
          {summary && <p class="mb-2 text-[var(--color-ink-muted)]">{summary}</p>}
          <ol class="list-decimal space-y-1 pl-4 text-[var(--color-ink)]">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      );
    }
    const text = resultText(call);
    if (!text && call.status === 'running') {
      return (
        <p class="px-3 py-2 text-xs text-[var(--color-ink-faint)]">En cours…</p>
      );
    }
    if (!text) return null;
    const preview = previewLines(text, kind === 'shell' ? 8 : 6);
    return (
      <pre class="overflow-x-auto whitespace-pre-wrap break-words bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
        {preview.text}
        {preview.more > 0 ? `\n… ${preview.more} lignes de plus` : ''}
      </pre>
    );
  }, [call, kind]);

  return (
    <div
      class={cn(
        'overflow-hidden rounded-xl border bg-[var(--color-surface)]',
        call.status === 'fail' || !ok
          ? 'border-rose-500/30'
          : 'border-[var(--color-line)]',
      )}
    >
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        onClick={() => setOpen((v) => !v)}
      >
        <ActionIcon kind={kind} status={call.status} />
        <span class="min-w-0 flex-1 truncate font-mono text-[13px] tracking-tight text-[var(--color-ink)]">
          {label}
        </span>
        {call.status === 'fail' || !ok ? (
          <span class="text-[11px] text-[var(--color-danger)]">échec</span>
        ) : call.status === 'ok' ? (
          <span class="text-[11px] text-[var(--color-ink-faint)]">ok</span>
        ) : null}
      </button>
      {open && body}
    </div>
  );
}

export function AgentActionList({
  actions,
  class: className,
}: {
  actions: LiveAction[];
  class?: string;
}) {
  if (actions.length === 0) return null;
  return (
    <div class={cn('max-w-[92%] space-y-2', className)}>
      {actions.map((a, i) => (
        <AgentActionCard
          key={`${a.name}-${i}`}
          call={a}
          defaultOpen={
            a.status === 'running' ||
            a.name === 'write_project_file' ||
            a.name === 'start_local_preview' ||
            a.name === 'propose_plan' ||
            a.name === 'run_application_tests'
          }
        />
      ))}
    </div>
  );
}

export function AgentThinkingBlock({
  label,
  startedAt,
}: {
  label: string;
  startedAt: number;
}) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const tick = () => setSecs(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <div class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
      <Spinner class="h-3.5 w-3.5" />
      <span>
        Réflexion {secs}s
        {label ? (
          <span class="text-[var(--color-ink-faint)]"> · {label}</span>
        ) : null}
      </span>
      <PulseDot tone="accent" />
    </div>
  );
}

export function AgentPlanActions({
  plan,
  canOpenPr,
  busy,
  onApprovePlan,
  onOpenPr,
}: {
  plan: AgentPlan;
  canOpenPr?: boolean;
  busy?: boolean;
  onApprovePlan?: () => void;
  onOpenPr?: () => void;
}) {
  if (!onApprovePlan && !(canOpenPr && onOpenPr)) return null;
  return (
    <div class="mt-2 flex flex-wrap gap-2" aria-label={plan.title}>
      {onApprovePlan && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={onApprovePlan}>
          Exécuter en local
        </Button>
      )}
      {canOpenPr && onOpenPr && (
        <Button size="sm" variant="primary" disabled={busy} onClick={onOpenPr}>
          Valider et créer une PR
        </Button>
      )}
    </div>
  );
}

export function toLiveActions(tools: AgentToolCall[]): LiveAction[] {
  return tools.map((t) => ({
    ...t,
    status: t.result?.ok === false ? 'fail' : 'ok',
  }));
}
