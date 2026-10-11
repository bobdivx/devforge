/** Images jointes (P5-02) : types acceptés, redimensionnement côté client au-delà de 2 000 px. */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_IMAGE_DIM = 2000;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 4;

export function isAcceptedImage(f: { type: string }): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(f.type);
}

/** Taille cible (ratio conservé), `null` si l'image est déjà assez petite. */
export function targetSize(w: number, h: number, max = MAX_IMAGE_DIM): { w: number; h: number } | null {
  const big = Math.max(w, h);
  if (!big || big <= max) return null;
  const k = max / big;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function withExt(name: string, ext: string): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '') || 'image';
  return `${base}.${ext}`;
}

/** Fichier prêt à l'envoi : GIF tel quel (animation), sinon WebP 0,85 si > 2 000 px. */
export async function prepareImage(file: File): Promise<{ blob: Blob; name: string; width?: number; height?: number }> {
  if (!isAcceptedImage(file)) throw new Error('Type refusé : PNG, JPEG, WebP ou GIF');
  const name = file.name || 'capture.png';
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return { blob: file, name };
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return { blob: file, name };
  }
  const target = targetSize(bmp.width, bmp.height);
  if (!target) {
    const out = { blob: file as Blob, name, width: bmp.width, height: bmp.height };
    bmp.close?.();
    return out;
  }
  const canvas = document.createElement('canvas');
  canvas.width = target.w;
  canvas.height = target.h;
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, target.w, target.h);
  bmp.close?.();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.85));
  if (!blob) return { blob: file, name };
  // Navigateur sans encodeur WebP : il renvoie du PNG.
  return { blob, name: withExt(name, blob.type === 'image/webp' ? 'webp' : 'png'), width: target.w, height: target.h };
}
