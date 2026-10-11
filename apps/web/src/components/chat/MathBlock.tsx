import { useEffect, useState } from 'preact/hooks';

type Katex = { renderToString: (tex: string, opts: Record<string, unknown>) => string };
let katexLoad: Promise<Katex> | null = null;

/** KaTeX + sa feuille de style, chargés seulement si une formule apparaît (P5-01). */
export function loadKatex(): Promise<Katex> {
  katexLoad ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
    ([k]) => ((k as unknown as { default?: Katex }).default ?? (k as unknown as Katex)),
  );
  return katexLoad;
}

/** Options sûres : pas de \href/\url actifs, pas de commandes HTML, erreurs affichées. */
export const KATEX_OPTIONS = { throwOnError: false, trust: false, strict: 'ignore', maxSize: 20, maxExpand: 200 } as const;

function useKatex(tex: string, display: boolean): string | null {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadKatex()
      .then((k) => {
        if (alive) setHtml(k.renderToString(tex, { ...KATEX_OPTIONS, displayMode: display }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tex, display]);
  return html;
}

export function MathInline({ tex }: { tex: string }) {
  const html = useKatex(tex, false);
  if (!html) return <code class="font-mono text-[0.92em] text-[var(--color-ink-muted)]">{tex}</code>;
  return <span class="df-math" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MathBlock({ tex }: { tex: string }) {
  const html = useKatex(tex, true);
  return (
    <div class="df-math-block max-w-full overflow-x-auto py-1 text-[15px]" data-math="block">
      {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <pre class="whitespace-pre-wrap font-mono text-[12.5px] text-[var(--color-ink-muted)]">{tex}</pre>}
    </div>
  );
}
