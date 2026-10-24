/** Minimal className merge (Plasma/shadcn-style). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  // Optimized with a manual loop to avoid intermediate array allocations
  // on a hot path, since this function is called frequently per render cycle.
  let str = '';
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) {
      if (str) str += ' ';
      str += parts[i];
    }
  }
  return str;
}
