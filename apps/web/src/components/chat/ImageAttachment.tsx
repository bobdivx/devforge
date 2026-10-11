import { flushSync, lazy, Suspense } from 'preact/compat';
import { useState } from 'preact/hooks';
import { cn } from '../../lib/cn';
import { prefersReducedMotion } from '../../lib/motion';
import { attachmentSrc } from './attachment-src';

// Visionneuse chargée au premier agrandissement (bundle initial du chat inchangé).
const ImageViewer = lazy(() => import('./ImageViewer').then((m) => ({ default: m.ImageViewer })));
let viewerReady: Promise<unknown> | null = null;
const preloadViewer = () => (viewerReady ??= import('./ImageViewer'));
import type { Attachment } from './types';

type VT = { startViewTransition?: (cb: () => void | Promise<void>) => unknown };

/** Lance une transition partagée vignette ↔ visionneuse ; repli : fondu + scale (CSS). */
function withTransition(update: () => void) {
  const doc = document as unknown as VT;
  if (!doc.startViewTransition || prefersReducedMotion()) return update();
  doc.startViewTransition(() => flushSync(update));
}

/** Grille 1–4 images d'un message (P5-02) : ratio réservé (pas de saut), chargement différé. */
export function ImageGrid({ images, align = 'end' }: { images: Attachment[]; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState<{ index: number; name?: string } | null>(null);
  if (!images.length) return null;
  const single = images.length === 1;

  async function openAt(i: number, el: HTMLElement) {
    await preloadViewer();
    const name = `img-${images[i].id.slice(0, 16)}`;
    el.style.viewTransitionName = name;
    withTransition(() => {
      el.style.viewTransitionName = '';
      setOpen({ index: i, name });
    });
  }
  function close() {
    const cur = open;
    if (!cur) return;
    const thumb = document.querySelector<HTMLElement>(`[data-att-id="${images[cur.index]?.id}"]`);
    if (!thumb || !cur.name) return setOpen(null);
    withTransition(() => {
      setOpen(null);
      thumb.style.viewTransitionName = cur.name ?? '';
    });
    window.setTimeout(() => (thumb.style.viewTransitionName = ''), 400);
  }

  return (
    <>
      <div
        class={cn('grid gap-1', single ? 'w-[min(18rem,70vw)] grid-cols-1' : 'w-[min(18rem,70vw)] grid-cols-2', align === 'end' ? 'ml-auto' : '')}
        data-image-grid={images.length}
      >
        {images.map((img, i) => (
          <button
            key={img.id}
            type="button"
            data-att-id={img.id}
            class="df-tap-skip group relative block overflow-hidden rounded-xl bg-white/[0.04] ring-1 ring-inset ring-[var(--color-line)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            style={{ aspectRatio: single && img.width && img.height ? `${img.width} / ${img.height}` : '1 / 1', maxHeight: single ? '20rem' : undefined }}
            aria-label={`Agrandir l’image ${img.name}`}
            onPointerEnter={() => void preloadViewer()}
            onClick={(e) => void openAt(i, e.currentTarget as HTMLElement)}
          >
            <img
              src={attachmentSrc(img)}
              alt={img.name}
              loading="lazy"
              decoding="async"
              width={img.width || undefined}
              height={img.height || undefined}
              class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            />
          </button>
        ))}
      </div>
      {open && (
        <Suspense fallback={null}>
          <ImageViewer
          images={images}
          index={open.index}
          transitionName={open.name}
          onIndex={(index) => setOpen({ index })}
          onClose={close}
          />
        </Suspense>
      )}
    </>
  );
}
