import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AgentPlan, AgentReflection, AgentToolCall } from '../../lib/agent-stream';
import { cn } from '../../lib/cn';
import { InlinePatch } from '../DiffViewer';
import { Button, PulseDot, Spinner } from '../ui';

export type LiveAction = AgentToolCall & { status: 'running' | 'ok' | 'fail' };

const SHELL_TOOLS = new Set([
  'start_local_preview',
  'stop_local_preview',
  'local_preview_status',
  'run_workdir_command',
  'run_application_tests',
  'get_deployment_logs',
  'http_smoke',
  'trigger_deploy',
  'mcp_call_tool',
  'publish_to_github',
  'sync_workdir_to_github',
  'create_github_pr',
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
  'list_project_agents',
  'list_agent_messages',
  'list_agent_tool_failures',
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
  if (typeof r.logs_tail === 'string' && r.logs_tail.trim()) return r.logs_tail;
  if (typeof r.content === 'string') return r.content;
  if (typeof r.logs === 'string') return r.logs;
  if (typeof r.output === 'string') return r.output;
  if (typeof r.stdout === 'string' || typeof r.stderr === 'string') {
    return [r.stdout, r.stderr].filter((s) => typeof s === 'string' && s.trim()).join('\n');
  }
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
    const add =
      typeof call.result?.additions === 'number' ? call.result.additions : lineCount(content);
    const del = typeof call.result?.deletions === 'number' ? call.result.deletions : 0;
    const lang = langFromPath(path);
    const base = path.split('/').pop() || path;
    if (call.result?.created) return `${lang} ${base} +${add}`;
    if (del > 0 || add > 0) {
      const parts = [`${lang} ${base}`];
      if (add > 0) parts.push(`+${add}`);
      if (del > 0) parts.push(`−${del}`);
      return parts.join(' ');
    }
    return `${lang} ${base}`;
  }
  if (kind === 'shell') {
    if (call.name === 'start_local_preview') {
      const cmd =
        strArg(call, 'command') ||
        (typeof call.result?.command === 'string' ? call.result.command : 'preview');
      return cmd;
    }
    if (call.name === 'run_workdir_command') {
      return (
        strArg(call, 'command') ||
        (typeof call.result?.command === 'string' ? call.result.command : 'shell')
      );
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

function ActionIcon({
  kind,
  status,
}: {
  kind: ReturnType<typeof kindOf>;
  status: LiveAction['status'];
}) {
  if (status === 'running') return <Spinner class="h-3.5 w-3.5 shrink-0" />;
  if (kind === 'shell') {
    return (
      <span class="w-4 shrink-0 text-center font-mono text-[11px] text-[var(--color-ink-faint)]">
        &gt;_
      </span>
    );
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
      const diff =
        typeof call.result?.unified_diff === 'string' ? call.result.unified_diff : '';
      if (diff.trim()) {
        const lines = diff.split('\n');
        const max = 80;
        const clipped =
          lines.length > max
            ? `${lines.slice(0, max).join('\n')}\n… ${lines.length - max} lignes`
            : diff;
        return (
          <div class="border-t border-[var(--color-line)]">
            <InlinePatch patch={clipped} />
          </div>
        );
      }
      if (!content) {
        return (
          <p class="px-3 py-2 text-xs text-[var(--color-ink-muted)]">
            {typeof call.result?.message === 'string' ? call.result.message : 'Fichier écrit.'}
          </p>
        );
      }
      const preview = previewLines(content, 24);
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
        : call.result?.plan?.steps?.map(String) || [];
      return (
        <ol class="list-decimal space-y-1 px-3 py-2 pl-7 text-xs text-[var(--color-ink-muted)]">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      );
    }
    const text = resultText(call);
    if (!text) return null;
    const preview = previewLines(text, 16);
    return (
      <pre class="overflow-x-auto whitespace-pre-wrap break-words bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
        {preview.text}
        {preview.more > 0 ? `\n… ${preview.more} lignes` : ''}
      </pre>
    );
  }, [call, kind]);

  return (
    <div class="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--color-bg)]/40"
        onClick={() => setOpen((o) => !o)}
      >
        <ActionIcon kind={kind} status={call.status} />
        <span class="min-w-0 flex-1 truncate font-medium text-[var(--color-ink)]">{label}</span>
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
            a.name === 'run_workdir_command' ||
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
  detail,
}: {
  label: string;
  startedAt: number;
  detail?: string;
}) {
  const [secs, setSecs] = useState(0);
  const [open, setOpen] = useState(Boolean(detail));
  useEffect(() => {
    const tick = () => setSecs(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <div class="max-w-[92%] space-y-1.5">
      <button
        type="button"
        class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]"
        onClick={() => detail && setOpen((o) => !o)}
      >
        <Spinner class="h-3.5 w-3.5" />
        <span>
          Réflexion {secs}s
          {label ? <span class="text-[var(--color-ink-faint)]"> · {label}</span> : null}
        </span>
        <PulseDot tone="accent" />
      </button>
      {open && detail ? (
        <div class="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]/80 px-3 py-2 text-xs leading-relaxed text-[var(--color-ink-muted)] whitespace-pre-wrap">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export function AgentReflectionList({ items }: { items: AgentReflection[] }) {
  if (!items.length) return null;
  return (
    <div class="max-w-[92%] space-y-2">
      {items.map((r, i) => (
        <AgentReflectionCard key={i} item={r} defaultOpen={i === items.length - 1} />
      ))}
    </div>
  );
}

function AgentReflectionCard({
  item,
  defaultOpen,
}: {
  item: AgentReflection;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const hasDetail = Boolean(item.detail?.trim());
  return (
    <div class="overflow-hidden rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-bg)]/40">
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)]/50"
        onClick={() => hasDetail && setOpen((o) => !o)}
      >
        <span class="text-[var(--color-ink-faint)]">·</span>
        <span class="min-w-0 flex-1 truncate">
          {item.label || 'Réflexion'}
          {item.round ? ` · tour ${item.round}` : ''}
        </span>
        {hasDetail ? (
          <span class="text-[10px] text-[var(--color-ink-faint)]">{open ? 'masquer' : 'voir'}</span>
        ) : null}
      </button>
      {open && hasDetail ? (
        <div class="border-t border-[var(--color-line)] px-3 py-2 text-xs leading-relaxed text-[var(--color-ink-muted)] whitespace-pre-wrap">
          {item.detail}
        </div>
      ) : null}
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
