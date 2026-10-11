import { useEffect, useRef, useState } from 'preact/hooks';
import { isAcceptedImage, MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE, prepareImage } from '../../lib/image-compress';
import { localMessageId } from '../../lib/chat-messages';
import type { Attachment } from './types';

export type PendingAttachment = {
  localId: string;
  name: string;
  previewUrl: string;
  status: 'uploading' | 'ready' | 'error';
  meta?: Attachment;
  error?: string;
};

export type Uploader = (file: Blob, name: string) => Promise<{ data: Attachment }>;

/** Images du composer (P5-02) : préparation, envoi immédiat, vignettes, retrait. */
export function useAttachments(upload: Uploader | null, onError?: (msg: string) => void) {
  const [items, setItemsState] = useState<PendingAttachment[]>([]);
  const ref = useRef<PendingAttachment[]>([]);
  const setItems = (fn: (prev: PendingAttachment[]) => PendingAttachment[]) => {
    ref.current = fn(ref.current);
    setItemsState(ref.current);
  };

  useEffect(() => () => ref.current.forEach((a) => URL.revokeObjectURL(a.previewUrl)), []);

  async function addFiles(files: File[]) {
    if (!upload) return;
    const images = files.filter(isAcceptedImage);
    if (images.length < files.length) onError?.('Seules les images PNG, JPEG, WebP ou GIF sont acceptées.');
    const room = MAX_IMAGES_PER_MESSAGE - ref.current.length;
    if (images.length > room) onError?.(`${MAX_IMAGES_PER_MESSAGE} images maximum par message.`);
    for (const file of images.slice(0, Math.max(0, room))) {
      const localId = localMessageId();
      const previewUrl = URL.createObjectURL(file);
      setItems((p) => [...p, { localId, name: file.name || 'image', previewUrl, status: 'uploading' }]);
      void (async () => {
        try {
          const ready = await prepareImage(file);
          if (ready.blob.size > MAX_IMAGE_BYTES) throw new Error('Image trop lourde (10 Mo max)');
          const res = await upload(ready.blob, ready.name);
          setItems((p) => p.map((a) => (a.localId === localId ? { ...a, status: 'ready', meta: res.data } : a)));
        } catch (e) {
          const msg = String((e as Error)?.message || e);
          setItems((p) => p.map((a) => (a.localId === localId ? { ...a, status: 'error', error: msg } : a)));
          onError?.(msg);
        }
      })();
    }
  }

  function remove(localId: string) {
    setItems((p) => {
      const gone = p.find((a) => a.localId === localId);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return p.filter((a) => a.localId !== localId);
    });
  }

  /** Images prêtes, retirées du composer (envoi). */
  function take(): Attachment[] {
    const ready = ref.current.filter((a) => a.status === 'ready' && a.meta).map((a) => a.meta as Attachment);
    ref.current.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setItems(() => []);
    return ready;
  }

  return {
    items,
    addFiles,
    remove,
    take,
    uploading: items.some((a) => a.status === 'uploading'),
    readyCount: items.filter((a) => a.status === 'ready').length,
    peekReady: () => ref.current.some((a) => a.status === 'ready'),
    isUploading: () => ref.current.some((a) => a.status === 'uploading'),
  };
}
