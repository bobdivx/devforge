import { Camera, Crosshair, ImagePlus, StickyNote, X } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AgentChatAttachment } from '../../lib/domain-api';

const MAX_ATTACHMENTS = 8;

type Props = {
    attachments: AgentChatAttachment[];
    onChange: (next: AgentChatAttachment[]) => void;
    disabled?: boolean;
};

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

export function CaptureToolbar({ attachments, onChange, disabled = false }: Props) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [picking, setPicking] = useState(false);
    const [noteDraft, setNoteDraft] = useState('');
    const atLimit = attachments.length >= MAX_ATTACHMENTS;

    const add = (item: AgentChatAttachment) => {
        if (atLimit || disabled) {
            return;
        }
        onChange([...attachments, item]);
    };

    const remove = (index: number) => {
        onChange(attachments.filter((_, i) => i !== index));
    };

    const onFile = async (event: Event) => {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file || !file.type.startsWith('image/')) {
            return;
        }
        try {
            const url = await readFileAsDataUrl(file);
            add({
                type: 'screenshot',
                label: file.name || 'Capture',
                url,
                text: '',
            });
        } catch {
            /* ignore */
        }
    };

    useEffect(() => {
        if (!picking) {
            return;
        }

        let hoverEl: HTMLElement | null = null;
        const prevOutline = new Map<HTMLElement, string>();

        const setOutline = (el: HTMLElement | null) => {
            if (hoverEl && hoverEl !== el) {
                hoverEl.style.outline = prevOutline.get(hoverEl) ?? '';
            }
            hoverEl = el;
            if (el) {
                if (!prevOutline.has(el)) {
                    prevOutline.set(el, el.style.outline);
                }
                el.style.outline = '2px solid oklch(var(--p))';
            }
        };

        const onMove = (ev: MouseEvent) => {
            const target = ev.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            if (target.closest('[data-devforge-capture-ignore]')) {
                return;
            }
            setOutline(target);
        };

        const onClick = (ev: MouseEvent) => {
            ev.preventDefault();
            ev.stopPropagation();
            const target = ev.target;
            if (!(target instanceof HTMLElement) || target.closest('[data-devforge-capture-ignore]')) {
                return;
            }
            const text = (target.innerText || target.textContent || '').trim().slice(0, 200);
            const tag = target.tagName.toLowerCase();
            const id = target.id ? `#${target.id}` : '';
            const cls = typeof target.className === 'string' && target.className
                ? `.${target.className.trim().split(/\s+/).slice(0, 2).join('.')}`
                : '';
            add({
                type: 'element',
                label: `${tag}${id}${cls}`.slice(0, 120),
                selector: `${tag}${id}${cls}`,
                text: text || undefined,
                url: window.location.href,
            });
            setPicking(false);
        };

        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') {
                setPicking(false);
            }
        };

        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKey, true);

        return () => {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKey, true);
            prevOutline.forEach((outline, el) => {
                el.style.outline = outline;
            });
        };
    }, [picking, attachments, atLimit, disabled]);

    const addNote = () => {
        const text = noteDraft.trim();
        if (!text) {
            return;
        }
        add({ type: 'annotation', label: 'Note', text });
        setNoteDraft('');
    };

    return (
        <div class="grid gap-2" data-devforge-capture-ignore>
            <div class="flex flex-wrap items-center gap-1">
                <input ref={fileRef} type="file" accept="image/*" class="hidden" onChange={(e) => void onFile(e)} />
                <button
                    type="button"
                    class="btn btn-ghost btn-xs gap-1"
                    disabled={disabled || atLimit}
                    onClick={() => fileRef.current?.click()}
                    title="Joindre une capture"
                >
                    <ImagePlus class="size-3.5" aria-hidden />
                    Image
                </button>
                <button
                    type="button"
                    class={`btn btn-xs gap-1 ${picking ? 'btn-warning' : 'btn-ghost'}`}
                    disabled={disabled || atLimit}
                    onClick={() => setPicking((value) => !value)}
                    title="Pointer un élément de la page"
                >
                    <Crosshair class="size-3.5" aria-hidden />
                    {picking ? 'Esc pour annuler' : 'Élément'}
                </button>
                <span class="ms-auto text-[10px] text-base-content/40">
                    <Camera class="me-1 inline size-3" aria-hidden />
                    {attachments.length}/{MAX_ATTACHMENTS}
                </span>
            </div>

            <div class="flex gap-1">
                <input
                    class="input input-bordered input-xs flex-1"
                    placeholder="Annotation rapide…"
                    value={noteDraft}
                    disabled={disabled || atLimit}
                    onInput={(e) => setNoteDraft((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            addNote();
                        }
                    }}
                />
                <button type="button" class="btn btn-ghost btn-xs" disabled={disabled || atLimit || noteDraft.trim() === ''} onClick={addNote}>
                    <StickyNote class="size-3.5" aria-hidden />
                </button>
            </div>

            {attachments.length > 0 && (
                <ul class="flex flex-wrap gap-1.5">
                    {attachments.map((item, index) => (
                        <li key={`${item.type}-${item.label}-${index}`} class="flex max-w-full items-center gap-1 rounded-full border border-base-300 bg-base-200/60 px-2 py-0.5 text-[10px]">
                            <span class="truncate">{item.label || item.type || 'capture'}</span>
                            <button type="button" class="btn btn-ghost btn-xs size-5 min-h-0 p-0" aria-label="Retirer" onClick={() => remove(index)}>
                                <X class="size-3" aria-hidden />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
