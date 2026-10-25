/**
 * Minimal className merge (Plasma/shadcn-style).
 * Optimized to use standard loop and string concatenation
 * to avoid array allocation/GC overhead on hot paths.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  let str = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part) {
      if (str) str += ' ';
      str += part;
    }
  }
  return str;
}
