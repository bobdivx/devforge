import { useEffect, useState } from 'preact/hooks';
import { Code2, Workflow } from 'lucide-preact';
import { sanitizeSvg } from '../../lib/sanitize-svg';
import { CodeBlock } from './CodeBlock';

type MermaidApi = {
  initialize: (cfg: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
};

let mermaidLoad: Promise<MermaidApi> | null = null;
let seq = 0;

function loadMermaid(): Promise<MermaidApi> {
  mermaidLoad ??= import('mermaid').then((m) => {
    const api = (m as unknown as { default: MermaidApi }).default;
    api.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark', fontFamily: 'inherit' });
    return api;
  });
  return mermaidLoad;
}

/** Diagramme mermaid (P5-01) : chargé à la demande, rendu après stabilisation du code (flux). */
export function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    let alive = true;
    // Le texte arrive par morceaux pendant un run : on attend qu'il ne bouge plus.
    const t = window.setTimeout(async () => {
      try {
        const api = await loadMermaid();
        const { svg } = await api.render(`df-mmd-${++seq}`, code);
        if (alive) {
          setSvg(sanitizeSvg(svg));
          setError(null);
        }
      } catch (e) {
        if (alive) setError(String((e as Error)?.message || e).split('\n')[0].slice(0, 160));
      }
    }, 450);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [code]);

  if (error) {
    return (
      <div class="space-y-1">
        <p class="text-[11px] text-[var(--color-warn)]">Diagramme illisible : {error}</p>
        <CodeBlock code={code} lang="mermaid" />
      </div>
    );
  }
  if (showCode || !svg) {
    return (
      <div class="space-y-1" data-mermaid={svg ? 'code' : 'loading'}>
        {svg && <ToggleButton showCode onClick={() => setShowCode(false)} />}
        <CodeBlock code={code} lang="mermaid" />
      </div>
    );
  }
  return (
    <figure class="df-mermaid max-w-full overflow-hidden rounded-lg border border-[var(--color-line)] bg-black/20" data-mermaid="svg">
      <div class="flex items-center justify-between border-b border-[var(--color-line)] px-3 py-1.5 text-[11px] text-[var(--color-ink-faint)]">
        <span class="inline-flex items-center gap-1">
          <Workflow size={12} aria-hidden /> diagramme
        </span>
        <ToggleButton showCode={false} onClick={() => setShowCode(true)} />
      </div>
      <div class="max-w-full overflow-auto p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </figure>
  );
}

function ToggleButton({ showCode, onClick }: { showCode: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class="df-hit df-tap-skip inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--color-ink-faint)] hover:bg-white/5 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
      onClick={onClick}
    >
      <Code2 size={12} aria-hidden />
      {showCode ? 'Voir le diagramme' : 'Voir le code'}
    </button>
  );
}
