import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-preact';
import { attachmentSrc } from './attachment-src';
import type { Attachment } from './types';
export const SWIPE_CLOSE_PX = 120;

/** Distance entre deux pointeurs (pincement). */
export function pinchDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clampScale(s: number): number {
  return Math.min(4, Math.max(1, s));
}

type Props = {
  images: Attachment[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Nom de transition partagé avec la vignette (View Transitions API). */
  transitionName?: string;
};

/** Visionneuse plein écran (P5-02) : zoom molette / pincement, glisser vers le bas pour fermer, Échap, flèches. */
export function ImageViewer({ images, index, onIndex, onClose, transitionName }: Props) {
  const img = images[index];
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragY, setDragY] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist?: number; scale: number; start?: { x: number; y: number }; pan: { x: number; y: number } } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restore = useRef<Element | null>(null);

  useEffect(() => {
    restore.current = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      (restore.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    setDragY(0);
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onClose, onIndex]);

  if (!img) return null;

  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current =
      pts.length === 2
        ? { dist: pinchDistance(pts[0], pts[1]), scale, pan }
        : { start: { x: e.clientX, y: e.clientY }, scale, pan };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length === 2 && g.dist) {
      setScale(clampScale((g.scale * pinchDistance(pts[0], pts[1])) / g.dist));
    } else if (g.start) {
      const dx = e.clientX - g.start.x;
      const dy = e.clientY - g.start.y;
      if (g.scale > 1) setPan({ x: g.pan.x + dx, y: g.pan.y + dy });
      else setDragY(Math.max(0, dy));
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      if (dragY > SWIPE_CLOSE_PX) onClose();
      else setDragY(0);
      if (scale <= 1.02) {
        setScale(1);
        setPan({ x: 0, y: 0 });
      }
    }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const next = clampScale(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    setScale(next);
    if (next === 1) setPan({ x: 0, y: 0 });
  };

  const fade = dragY ? Math.max(0.35, 1 - dragY / 400) : 1;
  const btn =
    'df-tap-skip inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Image ${index + 1} sur ${images.length} : ${img.name}`}
      class="df-viewer-bg fixed inset-0 z-[200] flex flex-col"
      style={{ background: `rgba(0,0,0,${0.92 * fade})` }}
      data-image-viewer
    >
      <div class="flex items-center justify-between gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <span class="min-w-0 truncate text-sm text-white/80">
          {images.length > 1 && <span class="mr-2 tabular-nums">{index + 1}/{images.length}</span>}
          {img.name}
        </span>
        <div class="flex shrink-0 items-center gap-2">
          <a class={btn} href={attachmentSrc(img)} target="_blank" rel="noopener noreferrer" aria-label="Ouvrir l’original" title="Ouvrir l’original">
            <ExternalLink size={18} aria-hidden />
          </a>
          <button ref={closeRef} type="button" class={btn} aria-label="Fermer" title="Fermer (Échap)" onClick={onClose}>
            <X size={20} aria-hidden />
          </button>
        </div>
      </div>
      <div
        class="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDblClick={() => {
          setScale((s) => (s > 1 ? 1 : 2));
          setPan({ x: 0, y: 0 });
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && scale === 1) onClose();
        }}
      >
        <img
          key={img.id}
          src={attachmentSrc(img)}
          alt={img.name}
          draggable={false}
          class={transitionName ? 'max-h-full max-w-full object-contain' : 'df-viewer-in max-h-full max-w-full object-contain'}
          style={{
            viewTransitionName: transitionName,
            transform: `translate(${pan.x}px, ${pan.y + dragY}px) scale(${scale})`,
            transition: gesture.current ? 'none' : 'transform 160ms ease-out',
            aspectRatio: img.width && img.height ? `${img.width} / ${img.height}` : undefined,
          }}
        />
        {index > 0 && (
          <button type="button" class={`${btn} absolute left-3 top-1/2 -translate-y-1/2 max-sm:hidden`} aria-label="Image précédente" onClick={() => onIndex(index - 1)}>
            <ChevronLeft size={22} aria-hidden />
          </button>
        )}
        {index < images.length - 1 && (
          <button type="button" class={`${btn} absolute right-3 top-1/2 -translate-y-1/2 max-sm:hidden`} aria-label="Image suivante" onClick={() => onIndex(index + 1)}>
            <ChevronRight size={22} aria-hidden />
          </button>
        )}
      </div>
      <p class="pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-xs text-white/50 sm:hidden">Glisse vers le bas pour fermer</p>
    </div>,
    document.body,
  );
}
