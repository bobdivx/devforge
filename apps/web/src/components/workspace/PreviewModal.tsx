import { useEffect, useState } from 'preact/hooks';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-preact';
import { Button, Portal } from '../ui';

type Props = {
  open: boolean;
  onClose: () => void;
  previewUrl: string | null;
  isProduction?: boolean;
};

export function PreviewModal({ open, onClose, previewUrl, isProduction }: Props) {
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !previewUrl) return null;

  const targetUrl = `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}_df=${nonce}`;

  return (
    <Portal>
    <div class="df-preview-enter fixed inset-0 z-50 flex flex-col bg-black">
      <div class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[var(--color-card)] px-4">
        <div class="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[var(--color-ink-muted)] transition duration-200 hover:bg-white/5 hover:text-[var(--color-ink)] active:scale-[0.98]"
            aria-label="Fermer"
          >
            <ArrowLeft size={16} strokeWidth={2} aria-hidden />
            Retour
          </button>
          <div class="min-w-0 truncate text-sm text-[var(--color-ink-muted)]">
            {isProduction && (
              <span class="mr-2 font-medium text-[var(--color-warn)]">Production</span>
            )}
            {!isProduction && (
              <span class="mr-2 font-medium text-[var(--color-ink-faint)]">Atelier</span>
            )}
            {previewUrl.replace(/^https?:\/\//, '')}
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setNonce((n) => n + 1)}
            title="Rafraîchir la preview"
          >
            <RefreshCw size={14} strokeWidth={2} aria-hidden />
            Rafraîchir
          </Button>
          <Button
            size="sm"
            variant="outline"
            href={previewUrl}
            target="_blank"
            title="Ouvrir dans un nouvel onglet"
          >
            <ExternalLink size={14} strokeWidth={2} aria-hidden />
            Nouvel onglet
          </Button>
        </div>
      </div>

      <div class="relative flex-1 bg-white/5">
        <iframe
          key={nonce}
          src={targetUrl}
          class="h-full w-full border-0"
          title="Preview"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
        />
      </div>
    </div>
    </Portal>
  );
}
