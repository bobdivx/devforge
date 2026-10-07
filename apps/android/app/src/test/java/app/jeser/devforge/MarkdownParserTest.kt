package app.jeser.devforge

import app.jeser.devforge.ui.markdown.MarkdownParser
import app.jeser.devforge.ui.markdown.MdBlock
import app.jeser.devforge.ui.markdown.MdInline
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownParserTest {
    @Test fun unsafe_links_become_text() {
        val inl = MarkdownParser.inline("[clique](javascript:alert(1)) et [ok](https://x.dev)")
        assertTrue(inl.none { it is MdInline.Link && it.url.startsWith("javascript") })
        assertEquals(MdInline.Link("ok", "https://x.dev"), inl.last())
        assertNull(MarkdownParser.safeHref("data:text/html,x"))
        assertEquals("mailto:a@b.c", MarkdownParser.safeHref("mailto:a@b.c"))
    }

    @Test fun inline_styles_and_code_is_raw() {
        val inl = MarkdownParser.inline("**gras** et *ita* et `a **b**`")
        assertTrue(inl[0] is MdInline.Bold)
        assertTrue(inl.any { it is MdInline.Italic })
        assertEquals(MdInline.Code("a **b**"), inl.last())
    }

    @Test fun html_is_not_interpreted() {
        val b = MarkdownParser.parse("<script>alert(1)</script>")
        assertEquals(MdBlock.Paragraph(listOf(MdInline.Text("<script>alert(1)</script>"))), b.single())
    }

    @Test fun bare_urls_trim_punctuation() {
        val inl = MarkdownParser.inline("Va sur https://vigie.example.app.")
        assertEquals(MdInline.Link("https://vigie.example.app", "https://vigie.example.app"), inl[1])
    }

    @Test fun blocks() {
        val md = """
            # Titre
            Un paragraphe
            sur deux lignes.

            - un
            - deux
              - sous
            1. premier

            ```bash
            npm run build
            ```
            > cité
            | a | b |
            |---|---|
            | 1 | 2 |
            ---
        """.trimIndent()
        val b = MarkdownParser.parse(md)
        assertTrue(b[0] is MdBlock.Heading)
        assertTrue((b[1] as MdBlock.Paragraph).inlines.contains(MdInline.Break))
        val list = b[2] as MdBlock.ListBlock
        assertEquals(4, list.items.size)
        assertEquals(1, list.items[2].depth)
        assertEquals("1.", list.items[3].marker)
        assertEquals(MdBlock.Code("npm run build", "bash"), b[3])
        assertTrue(b[4] is MdBlock.Quote)
        assertEquals(1, (b[5] as MdBlock.Table).rows.size)
        assertEquals(MdBlock.Rule, b[6])
    }

    @Test fun unclosed_fence_does_not_crash() {
        val b = MarkdownParser.parse("```\ncode sans fin")
        assertEquals(MdBlock.Code("code sans fin", null), b.single())
    }
}
