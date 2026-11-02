import type { ComponentChildren, VNode } from 'preact';
import { CodeBlock } from '../chat/CodeBlock';
import { headingId, parseWikiLink, resolveHref, wikiHref } from '../../lib/wiki';

/*
 * Rendu Markdown du wiki public. Comme `lib/markdown.tsx` : aucun innerHTML, tout
 * devient des nœuds Preact, donc le HTML brut des fichiers reste du texte.
 * Liens : pages connues du wiki, ancres, http(s)/mailto ; le reste est affiché en texte.
 * En plus du rendu chat : vrais titres h1–h4 avec ancres, listes imbriquées,
 * blocs de code dans les listes, `[[Page]]` / `[[Libellé|Page]]` du GitHub Wiki.
 */

export interface WikiRenderContext {
  known: ReadonlySet<string>;
}

const LINK = 'text-[var(--color-accent)] underline decoration-[var(--color-accent)]/40 underline-offset-2 hover:decoration-[var(--color-accent)] [overflow-wrap:anywhere]';
const INLINE_CODE =
  'rounded-md bg-white/[0.07] px-1.5 py-px font-mono text-[0.86em] text-[var(--color-ink)] [overflow-wrap:anywhere]';

function link(key: string, href: string, external: boolean, children: ComponentChildren): VNode {
  return external ? (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer" class={LINK}>
      {children}
    </a>
  ) : (
    <a key={key} href={href} class={LINK}>
      {children}
    </a>
  );
}

export function renderWikiInline(text: string, ctx: WikiRenderContext, keyBase = 'i'): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  const re =
    /(`+)([^`]+?)\1|\[\[([^\]\n]+)\]\]|!?\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(^|[^\w*])\*(?=\S)([^*\n]+?)\*(?!\w)|(^|[^\w_])_(?=\S)([^_\n]+?)_(?!\w)|(https?:\/\/[^\s<>()`]+[^\s<>().,;:!?'"»`])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${n++}`;
    if (m[2] !== undefined) {
      out.push(
        <code key={k} class={INLINE_CODE}>
          {m[2]}
        </code>,
      );
    } else if (m[3] !== undefined) {
      const wl = parseWikiLink(m[3]);
      out.push(
        ctx.known.has(wl.slug)
          ? link(k, wikiHref(wl.slug, wl.anchor), false, wl.label)
          : (
              <span key={k} class="text-[var(--color-ink-muted)]" title="Page absente du wiki">
                {wl.label}
              </span>
            ),
      );
    } else if (m[4] !== undefined) {
      const r = resolveHref(m[5], ctx.known);
      const label = renderWikiInline(m[4], ctx, k);
      out.push(r.kind === 'none' ? <span key={k}>{label}</span> : link(k, r.href, r.kind === 'external', label));
    } else if (m[6] !== undefined || m[7] !== undefined) {
      out.push(
        <strong key={k} class="font-semibold text-[var(--color-ink)]">
          {renderWikiInline(m[6] ?? m[7], ctx, k)}
        </strong>,
      );
    } else if (m[9] !== undefined || m[11] !== undefined) {
      const prefix = (m[9] !== undefined ? m[8] : m[10]) ?? '';
      if (prefix) out.push(prefix);
      out.push(<em key={k}>{renderWikiInline((m[9] ?? m[11]) as string, ctx, k)}</em>);
    } else if (m[12] !== undefined) {
      out.push(link(k, m[12], true, m[12]));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const FENCE = /^(\s*)(```+|~~~+)\s*([\w+.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>/;

const indentOf = (l: string) => l.match(/^\s*/)![0].replace(/\t/g, '  ').length;

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

/** Découpe une ligne de tableau sans couper `[[Libellé|Page]]` ni le `code`. */
export function splitTableRow(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  let depth = 0;
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '`') inCode = !inCode;
    else if (!inCode && c === '[' && s[i + 1] === '[') {
      depth++;
      cur += '[[';
      i++;
      continue;
    } else if (!inCode && c === ']' && s[i + 1] === ']' && depth > 0) {
      depth--;
      cur += ']]';
      i++;
      continue;
    } else if (c === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    } else if (c === '|' && !inCode && depth === 0) {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-3xl',
  2: 'mt-8 border-b border-[var(--color-line)] pb-2 text-xl font-semibold tracking-tight text-[var(--color-ink)]',
  3: 'mt-6 text-lg font-semibold text-[var(--color-ink)]',
  4: 'mt-5 text-base font-semibold text-[var(--color-ink)]',
};

function isBlockStart(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    (line.includes('|') && next !== undefined && isTableSep(next))
  );
}

function renderBlocks(
  lines: string[],
  ctx: WikiRenderContext,
  keyBase: string,
  ids: Map<string, number>,
  tight = false,
): VNode[] {
  const blocks: VNode[] = [];
  let i = 0;
  let b = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `${keyBase}b${b++}`;
    const fence = line.match(FENCE);
    if (fence) {
      const indent = fence[1].length;
      const marker = fence[2];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        const l = lines[i++];
        const cut = Math.min(indent, indentOf(l));
        body.push(l.slice(cut));
      }
      i++;
      blocks.push(
        <div key={key} class="my-3 min-w-0">
          <CodeBlock code={body.join('\n')} lang={fence[3] || undefined} />
        </div>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(HEADING);
    if (h) {
      const level = Math.min(h[1].length, 4);
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
      let id = headingId(h[2]) || 'section';
      const seen = ids.get(id) ?? 0;
      ids.set(id, seen + 1);
      if (seen) id = `${id}-${seen}`;
      blocks.push(
        <Tag key={key} id={id} class={`${HEADING_CLASS[level]} scroll-mt-24`}>
          {renderWikiInline(h[2], ctx, key)}
        </Tag>,
      );
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push(<hr key={key} class="my-6 border-[var(--color-line)]" />);
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitTableRow(lines[i++]));
      blocks.push(
        <div key={key} class="my-4 max-w-full overflow-x-auto rounded-xl border border-[var(--color-line)]">
          <table class="w-full min-w-[34rem] text-left text-[13.5px] sm:min-w-0">
            <thead class="bg-white/[0.04] text-[var(--color-ink)]">
              <tr>
                {head.map((c, j) => (
                  <th key={j} class="px-3 py-2 font-semibold">
                    {renderWikiInline(c, ctx, `${key}-h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} class="border-t border-[var(--color-line)]">
                  {r.map((c, j) => (
                    <td key={j} class="px-3 py-2 align-top">
                      {renderWikiInline(c, ctx, `${key}-${ri}-${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (QUOTE.test(line)) {
      const q: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) q.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      blocks.push(
        <blockquote
          key={key}
          class="my-4 rounded-r-xl border-l-2 border-[var(--color-accent)]/60 bg-[var(--color-accent-soft)] px-4 py-2.5 text-[var(--color-ink)]"
        >
          {renderBlocks(q, ctx, key, ids, true)}
        </blockquote>,
      );
      continue;
    }
    const li = line.match(LIST_ITEM);
    if (li) {
      const base = indentOf(line);
      const ordered = /\d/.test(li[2]);
      const start = ordered ? parseInt(li[2], 10) : 1;
      const items: string[][] = [];
      let looseGap = false;
      while (i < lines.length) {
        const l = lines[i];
        const mm = l.match(LIST_ITEM);
        if (mm && indentOf(l) === base && /\d/.test(mm[2]) === ordered) {
          const contentIndent = base + mm[2].length + 1;
          const item = [mm[3]];
          i++;
          while (i < lines.length) {
            const c = lines[i];
            if (!c.trim()) {
              // Ligne vide : l'item continue seulement si la suite est indentée.
              let j = i;
              while (j < lines.length && !lines[j].trim()) j++;
              if (j < lines.length && indentOf(lines[j]) > base) {
                looseGap = true;
                for (; i < j; i++) item.push('');
                continue;
              }
              break;
            }
            if (indentOf(c) > base) {
              item.push(c.slice(Math.min(contentIndent, indentOf(c))));
              i++;
              continue;
            }
            // Continuation paresseuse d'un paragraphe.
            if (!isBlockStart(c, lines[i + 1]) && item[item.length - 1]?.trim()) {
              item.push(c.trim());
              i++;
              continue;
            }
            break;
          }
          items.push(item);
          continue;
        }
        if (!l.trim()) {
          let j = i;
          while (j < lines.length && !lines[j].trim()) j++;
          const nx = j < lines.length ? lines[j].match(LIST_ITEM) : null;
          if (nx && indentOf(lines[j]) === base && /\d/.test(nx[2]) === ordered) {
            looseGap = true;
            i = j;
            continue;
          }
        }
        break;
      }
      const cls = ordered ? 'my-3 list-decimal space-y-1.5 pl-6' : 'my-3 list-disc space-y-1.5 pl-6';
      const children = items.map((it, j) => (
        <li key={j} class="pl-1 marker:text-[var(--color-ink-faint)]">
          {renderBlocks(it, ctx, `${key}-${j}`, ids, !looseGap)}
        </li>
      ));
      blocks.push(
        ordered ? (
          <ol key={key} class={cls} start={start !== 1 ? start : undefined}>
            {children}
          </ol>
        ) : (
          <ul key={key} class={cls}>
            {children}
          </ul>
        ),
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i], lines[i + 1]))) {
      para.push(lines[i++].trim());
    }
    const inline: ComponentChildren[] = [];
    para.forEach((l, j) => {
      // Deux espaces finaux ou `\` : retour à la ligne forcé (Markdown).
      const hard = /( {2,}|\\)$/.test(lines[i - para.length + j] ?? '');
      inline.push(...renderWikiInline(l.replace(/\\$/, ''), ctx, `${key}-${j}`));
      if (j < para.length - 1) inline.push(hard ? <br key={`${key}-br${j}`} /> : ' ');
    });
    blocks.push(
      tight ? (
        <div key={key} class="my-0.5">
          {inline}
        </div>
      ) : (
        <p key={key} class="my-3 leading-7">
          {inline}
        </p>
      ),
    );
  }
  return blocks;
}

export function WikiMarkdown({ text, known }: { text: string; known: ReadonlySet<string> }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return (
    <div class="wiki-prose min-w-0 break-words text-[15px] leading-7 text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
      {renderBlocks(lines, { known }, 'w', new Map())}
    </div>
  );
}
