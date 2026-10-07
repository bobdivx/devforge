package app.jeser.devforge.ui.markdown

/**
 * Markdown sûr pour les messages des personnages : sous-ensemble volontairement réduit,
 * aucune interprétation HTML, liens limités à http(s) et mailto.
 */
sealed interface MdBlock {
    data class Paragraph(val inlines: List<MdInline>) : MdBlock
    data class Heading(val level: Int, val inlines: List<MdInline>) : MdBlock
    data class Code(val text: String, val lang: String?) : MdBlock
    data class Quote(val inlines: List<MdInline>) : MdBlock
    data class ListBlock(val ordered: Boolean, val items: List<ListItem>) : MdBlock
    data class Table(val header: List<List<MdInline>>, val rows: List<List<List<MdInline>>>) : MdBlock
    data object Rule : MdBlock
}

data class ListItem(val marker: String, val inlines: List<MdInline>, val depth: Int)

sealed interface MdInline {
    data class Text(val text: String) : MdInline
    data class Bold(val children: List<MdInline>) : MdInline
    data class Italic(val children: List<MdInline>) : MdInline
    data class Code(val text: String) : MdInline
    data class Link(val text: String, val url: String) : MdInline
    data object Break : MdInline
}

object MarkdownParser {
    fun safeHref(raw: String): String? {
        val url = raw.trim()
        val lower = url.lowercase()
        return if (lower.startsWith("https://") || lower.startsWith("http://") || lower.startsWith("mailto:")) url else null
    }

    fun parse(text: String): List<MdBlock> {
        val lines = text.replace("\r\n", "\n").split('\n')
        val out = mutableListOf<MdBlock>()
        var i = 0
        val para = mutableListOf<String>()
        fun flush() {
            if (para.isNotEmpty()) {
                out += MdBlock.Paragraph(inlineWithBreaks(para))
                para.clear()
            }
        }
        while (i < lines.size) {
            val line = lines[i]
            val trimmed = line.trim()
            when {
                trimmed.startsWith("```") -> {
                    flush()
                    val lang = trimmed.removePrefix("```").trim().ifEmpty { null }
                    val body = mutableListOf<String>()
                    i++
                    while (i < lines.size && !lines[i].trim().startsWith("```")) {
                        body += lines[i]; i++
                    }
                    out += MdBlock.Code(body.joinToString("\n"), lang)
                    i++ // fence fermante (ou fin)
                    continue
                }
                trimmed.isEmpty() -> flush()
                HEADING.matches(trimmed) -> {
                    flush()
                    val m = HEADING.find(trimmed)!!
                    out += MdBlock.Heading(m.groupValues[1].length.coerceAtMost(3), inline(m.groupValues[2]))
                }
                RULE.matches(trimmed) -> { flush(); out += MdBlock.Rule }
                trimmed.startsWith("|") && i + 1 < lines.size && TABLE_SEP.matches(lines[i + 1].trim()) -> {
                    flush()
                    val header = cells(trimmed).map(::inline)
                    i += 2
                    val rows = mutableListOf<List<List<MdInline>>>()
                    while (i < lines.size && lines[i].trim().startsWith("|")) {
                        rows += cells(lines[i].trim()).map(::inline); i++
                    }
                    out += MdBlock.Table(header, rows)
                    continue
                }
                trimmed.startsWith(">") -> {
                    flush()
                    val body = mutableListOf<String>()
                    while (i < lines.size && lines[i].trim().startsWith(">")) {
                        body += lines[i].trim().removePrefix(">").trimStart(); i++
                    }
                    out += MdBlock.Quote(inlineWithBreaks(body))
                    continue
                }
                LIST.matches(line) -> {
                    flush()
                    val ordered = LIST.find(line)!!.groupValues[2].first().isDigit()
                    val items = mutableListOf<ListItem>()
                    while (i < lines.size && LIST.matches(lines[i])) {
                        val m = LIST.find(lines[i])!!
                        val depth = (m.groupValues[1].length / 2).coerceAtMost(3)
                        val marker = if (m.groupValues[2].first().isDigit()) m.groupValues[2] else "•"
                        items += ListItem(marker, inline(m.groupValues[3]), depth)
                        i++
                    }
                    out += MdBlock.ListBlock(ordered, items)
                    continue
                }
                else -> para += line
            }
            i++
        }
        flush()
        return out
    }

    private fun cells(row: String): List<String> =
        row.trim().removePrefix("|").removeSuffix("|").split('|').map { it.trim() }

    private fun inlineWithBreaks(lines: List<String>): List<MdInline> {
        val out = mutableListOf<MdInline>()
        lines.forEachIndexed { idx, l ->
            if (idx > 0) out += MdInline.Break
            out += inline(l.trim())
        }
        return out
    }

    /** Inline : code d'abord (contenu brut), puis liens, gras, italique, URL nues. */
    fun inline(text: String): List<MdInline> {
        val out = mutableListOf<MdInline>()
        val buf = StringBuilder()
        fun flushText() {
            if (buf.isNotEmpty()) { out += MdInline.Text(buf.toString()); buf.clear() }
        }
        var i = 0
        while (i < text.length) {
            val c = text[i]
            // `code`
            if (c == '`') {
                val end = text.indexOf('`', i + 1)
                if (end > i + 1) {
                    flushText(); out += MdInline.Code(text.substring(i + 1, end)); i = end + 1; continue
                }
            }
            // [texte](url)
            if (c == '[') {
                val close = text.indexOf("](", i + 1)
                val paren = if (close > 0) text.indexOf(')', close + 2) else -1
                if (close > i && paren > close) {
                    val label = text.substring(i + 1, close)
                    val href = safeHref(text.substring(close + 2, paren))
                    flushText()
                    out += if (href != null) MdInline.Link(label, href) else MdInline.Text(label)
                    i = paren + 1
                    continue
                }
            }
            // **gras**
            if (text.startsWith("**", i)) {
                val end = text.indexOf("**", i + 2)
                if (end > i + 2) {
                    flushText(); out += MdInline.Bold(inline(text.substring(i + 2, end))); i = end + 2; continue
                }
            }
            // *italique* ou _italique_ (pas au milieu d'un mot pour `_`)
            if ((c == '*' || (c == '_' && (i == 0 || !text[i - 1].isLetterOrDigit()))) && i + 1 < text.length && text[i + 1] != ' ') {
                val end = text.indexOf(c, i + 1)
                if (end > i + 1 && text[end - 1] != ' ' && (c == '*' || end + 1 >= text.length || !text[end + 1].isLetterOrDigit())) {
                    flushText(); out += MdInline.Italic(inline(text.substring(i + 1, end))); i = end + 1; continue
                }
            }
            // URL nue
            if ((c == 'h') && (text.startsWith("https://", i) || text.startsWith("http://", i)) &&
                (i == 0 || !text[i - 1].isLetterOrDigit())
            ) {
                var end = i
                while (end < text.length && !text[end].isWhitespace() && text[end] != '<' && text[end] != '>') end++
                while (end > i && text[end - 1] in ".,;:!?)»") end--
                flushText()
                val url = text.substring(i, end)
                out += MdInline.Link(url, url)
                i = end
                continue
            }
            buf.append(c)
            i++
        }
        flushText()
        return out
    }

    private val HEADING = Regex("^(#{1,6})\\s+(.+)$")
    private val RULE = Regex("^(-{3,}|\\*{3,}|_{3,})$")
    private val TABLE_SEP = Regex("^\\|?\\s*:?-{2,}:?\\s*(\\|\\s*:?-{2,}:?\\s*)*\\|?$")
    private val LIST = Regex("^(\\s*)([-*+]|\\d{1,3}[.)])\\s+(.*)$")
}
