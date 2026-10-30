/** Minimal className merge (Plasma/shadcn-style). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  let result = '';
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) {
      if (result) result += ' ';
      result += parts[i];
    }
  }
  return result;
}
