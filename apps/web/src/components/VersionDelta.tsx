/** Trois lignes de la release, révélées avant d’appliquer. */
export function VersionDelta({
  version,
  notes,
}: {
  version: string;
  notes?: string[] | null;
}) {
  const lines = (notes ?? []).map((n) => n.trim()).filter(Boolean).slice(0, 3);
  if (!lines.length) return null;
  const shown = version.replace(/^v/i, '');
  return (
    <div
      class="df-delta-in rounded-xl border border-[var(--color-line)] bg-white/[0.03] px-3 py-2.5"
      data-df-version-delta
    >
      <p class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
        Cible v{shown}
      </p>
      <ul class="mt-1.5 space-y-1">
        {lines.map((line, i) => (
          <li
            key={`${i}-${line.slice(0, 24)}`}
            class="df-delta-line text-sm leading-snug text-[var(--color-ink)]"
            style={{ animationDelay: `${80 + i * 70}ms` }}
          >
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
