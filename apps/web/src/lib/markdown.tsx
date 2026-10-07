import type { ComponentChildren, VNode } from 'preact';

/*
 * Rendu Markdown minimal et sûr pour les messages d'agents.
 * Aucun innerHTML : le texte devient des nœuds Preact, donc tout HTML brut
 * reste affiché comme du texte. Liens limités à http(s) et mailto.
 * Gère : paragraphes, titres, listes, citations, blocs de code, tableaux simples,
 * **gras**, *italique*, `code`, [liens](https://…) et URL nues.
 */

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function safeHref(url: string): string | null {
  const u = url.trim();
  return SAFE_URL.test(u) ? u : null;
}

const INLINE_CODE = 'rounded bg-white/[0.07] px-1 py-px font-mono text-[0.86em] [overflow-wrap:anywhere]';
const LINK = 'text-[var(--color-accent)] underline underline-offset-2 [overflow-wrap:anywhere] hover:brightness-110';

/** Inline : code, gras, italique, liens, URL nues. */
export function renderInline(text: string, keyBase = 'i'): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  // Ordre : code d'abord (son contenu n'est pas interprété), puis liens, gras, italique, URL.
  const re =
    /(`+)([^`]+?)\1|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(^|[^\w*])\*(?=\S)([^*\n]+?)\*(?!\w)|(^|[^\w_])_(?=\S)([^_\n]+?)_(?!\w)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"»])/g;
  // Pas de lookbehind : non supporté par les anciens Safari iOS (le bundle entier planterait).
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${n++}`;
    if (m[2] !== undefined) {
      out.push(<code key={k} class={INLINE_CODE}>{m[2]}</code>);
    } else if (m[3] !== undefined) {
      const href = safeHref(m[4]);
      out.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer" class={LINK}>
            {renderInline(m[3], k)}
          </a>
        ) : (
          m[0]
        ),
      );
    } else if (m[5] !== undefined || m[6] !== undefined) {
      out.push(<strong key={k} class="font-semibold">{renderInline(m[5] ?? m[6], k)}</strong>);
    } else if (m[8] !== undefined || m[10] !== undefined) {
      const prefix = (m[8] !== undefined ? m[7] : m[9]) ?? '';
      if (prefix) out.push(prefix);
      out.push(<em key={k}>{renderInline((m[8] ?? m[10]) as string, k)}</em>);
    } else if (m[11] !== undefined) {
      out.push(
        <a key={k} href={m[11]} target="_blank" rel="noopener noreferrer" class={LINK}>
          {m[11]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Retours à la ligne simples dans un paragraphe → <br />. */
function inlineWithBreaks(lines: string[], key: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  lines.forEach((l, i) => {
    if (i > 0) out.push(<br key={`${key}-br${i}`} />);
    out.push(...renderInline(l, `${key}-${i}`));
  });
  return out;
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const splitRow = (l: string) =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function Markdown({ text, class: className }: { text: string; class?: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: VNode[] = [];
  let i = 0;
  let b = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${b++}`;
    // Bloc de code
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre
          key={key}
          class="max-w-full whitespace-pre-wrap rounded-lg border border-[var(--color-line)] bg-black/30 px-3 py-2 font-mono text-[12.5px] leading-relaxed [overflow-wrap:anywhere]"
        >
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    // Titre
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push(
        <p key={key} class={h[1].length <= 2 ? 'text-[15px] font-semibold' : 'font-semibold'}>
          {renderInline(h[2], key)}
        </p>,
      );
      i++;
      continue;
    }
    // Séparateur
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={key} class="border-[var(--color-line)]" />);
      i++;
      continue;
    }
    // Tableau
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      blocks.push(
        <div key={key} class="max-w-full overflow-x-auto rounded-lg border border-[var(--color-line)]">
          <table class="w-full text-left text-[13px]">
            <thead class="bg-white/[0.04]">
              <tr>
                {head.map((c, j) => (
                  <th key={j} class="px-2.5 py-1.5 font-semibold">
                    {renderInline(c, `${key}-h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} class="border-t border-[var(--color-line)]">
                  {r.map((c, j) => (
                    <td key={j} class="px-2.5 py-1.5 align-top [overflow-wrap:anywhere]">
                      {renderInline(c, `${key}-${ri}-${j}`)}
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
    // Citation
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(
        <blockquote key={key} class="border-l-2 border-[var(--color-line-strong)] pl-3 text-[var(--color-ink-muted)]">
          {inlineWithBreaks(q, key)}
        </blockquote>,
      );
      continue;
    }
    // Listes
    const ul = /^\s*[-*+]\s+(.*)$/;
    const ol = /^\s*(\d+)[.)]\s+(.*)$/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const re = ordered ? ol : ul;
      const items: string[][] = [];
      while (i < lines.length) {
        const l = lines[i];
        const mm = l.match(re);
        if (mm) {
          items.push([ordered ? mm[2] : mm[1]]);
          i++;
        } else if (items.length && /^\s{2,}\S/.test(l) && !ul.test(l) && !ol.test(l)) {
          items[items.length - 1].push(l.trim());
          i++;
        } else if (items.length && /^\s+[-*+]\s+|^\s+\d+[.)]\s+/.test(l)) {
          // Sous-liste : aplatie en ligne indentée.
          items[items.length - 1].push(`• ${l.trim().replace(/^[-*+]\s+|^\d+[.)]\s+/, '')}`);
          i++;
        } else break;
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={key} class={ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5'}>
          {items.map((it, j) => (
            <li key={j}>{inlineWithBreaks(it, `${key}-${j}`)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    // Paragraphe
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|~~~)/.test(lines[i]) &&
      !/^\s*#{1,6}\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !ul.test(lines[i]) &&
      !ol.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) {
      para.push(lines[i++]);
    }
    if (!para.length) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={key}>{inlineWithBreaks(para, key)}</p>);
  }
  return <div class={className ?? 'min-w-0 space-y-2 break-words [overflow-wrap:anywhere]'}>{blocks}</div>;
}
