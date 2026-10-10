import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { cn } from '../../lib/cn';
import { messageIn, type AnimateLifecycleProps } from '../../lib/motion';

/**
 * Enveloppe d'entrée d'un message. N'anime que les messages apparus après le montage
 * du fil (`animate`), une seule fois : le preset est figé au premier rendu, et la clé
 * React (id du message) empêche toute ré-animation au polling.
 */
export function MessageEnter({
  role,
  animate,
  class: className,
  children,
}: {
  role: 'user' | 'assistant';
  animate: boolean;
  class?: string;
  children: ComponentChildren;
}) {
  const preset = useRef<AnimateLifecycleProps | undefined | null>(null);
  if (preset.current === null) preset.current = animate ? messageIn(role) : undefined;
  return (
    <div
      class={cn(className, role === 'user' && 'origin-bottom-right')}
      data-message-enter={animate ? 'animated' : 'static'}
      animate={preset.current}
    >
      {children}
    </div>
  );
}
