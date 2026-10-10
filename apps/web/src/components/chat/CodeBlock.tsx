import { useEffect, useRef, useState } from 'preact/hooks';
import { Check, Copy } from 'lucide-preact';
import { copyText } from '../../lib/clipboard';

/** Bloc de code des messages : langue + bouton « Copier », défilement horizontal. */
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function onCopy() {
    const ok = await copyText(code);
    setCopied(ok);
    setFailed(!ok);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 1500);
  }

  return (
    <div
      class="df-codeblock max-w-full overflow-hidden rounded-lg border border-[var(--color-line)] bg-black/30"
      data-lang={lang || undefined}
    >
      <div class="flex items-center justify-between border-b border-[var(--color-line)] px-3 py-1.5 text-[11px] text-[var(--color-ink-faint)]">
        <span class="font-mono lowercase">{lang || 'texte'}</span>
        <button
          type="button"
          class="df-hit df-tap-skip inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--color-ink-faint)] transition-colors hover:bg-white/5 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
          aria-label="Copier le code"
          title="Copier le code"
          onClick={() => void onCopy()}
        >
          {copied ? (
            <Check size={13} strokeWidth={2.2} class="df-copy-pop scale-110 text-[var(--color-ok)] transition-transform duration-150" aria-hidden />
          ) : (
            <Copy size={13} strokeWidth={2} class="transition-transform duration-150" aria-hidden />
          )}
          <span aria-live="polite">{copied ? 'Copié' : failed ? 'Échec' : 'Copier'}</span>
        </button>
      </div>
      <pre class="max-h-[480px] max-w-full overflow-auto whitespace-pre px-3 py-2 font-mono text-[12.5px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
