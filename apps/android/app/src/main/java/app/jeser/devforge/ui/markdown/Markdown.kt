package app.jeser.devforge.ui.markdown

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.ui.theme.DfColors

fun inlineToAnnotated(inlines: List<MdInline>, accent: Color, codeBg: Color): AnnotatedString = buildAnnotatedString {
    fun emit(list: List<MdInline>) {
        for (n in list) when (n) {
            is MdInline.Text -> append(n.text)
            is MdInline.Break -> append('\n')
            is MdInline.Bold -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { emit(n.children) }
            is MdInline.Italic -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { emit(n.children) }
            // Espaces insécables autour : le code long reste lisible et se replie avec le texte.
            is MdInline.Code -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBg, fontSize = 13.sp)) {
                append('\u2009'); append(n.text); append('\u2009')
            }
            is MdInline.Link -> withLink(
                LinkAnnotation.Url(
                    n.url,
                    TextLinkStyles(SpanStyle(color = accent, textDecoration = TextDecoration.Underline)),
                ),
            ) { append(n.text) }
        }
    }
    emit(inlines)
}

@Composable
fun MarkdownText(text: String, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onSurface) {
    val blocks = remember(text) { MarkdownParser.parse(text) }
    val accent = MaterialTheme.colorScheme.primary
    val codeBg = DfColors.Surface2
    val body = MaterialTheme.typography.bodyLarge.copy(color = color, fontSize = 15.sp, lineHeight = 22.sp)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (b in blocks) when (b) {
            is MdBlock.Paragraph -> Text(inlineToAnnotated(b.inlines, accent, codeBg), style = body)
            is MdBlock.Heading -> Text(
                inlineToAnnotated(b.inlines, accent, codeBg),
                style = when (b.level) {
                    1 -> MaterialTheme.typography.titleLarge
                    2 -> MaterialTheme.typography.titleMedium
                    else -> MaterialTheme.typography.titleSmall
                }.copy(color = color, fontWeight = FontWeight.SemiBold),
            )
            is MdBlock.Code -> Box(
                Modifier.fillMaxWidth()
                    .background(DfColors.Bg, RoundedCornerShape(10.dp))
                    .horizontalScroll(rememberScrollState())
                    .padding(12.dp),
            ) {
                Text(b.text, style = body.copy(fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 18.sp))
            }
            is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
                Box(Modifier.width(3.dp).fillMaxHeight().background(accent.copy(alpha = .5f), RoundedCornerShape(2.dp)))
                Text(
                    inlineToAnnotated(b.inlines, accent, codeBg),
                    style = body.copy(color = DfColors.InkMuted),
                    modifier = Modifier.padding(start = 10.dp),
                )
            }
            is MdBlock.ListBlock -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                b.items.forEach { item ->
                    Row(Modifier.padding(start = (item.depth * 16).dp)) {
                        Text(item.marker, style = body.copy(color = DfColors.InkMuted), modifier = Modifier.widthIn(min = 18.dp))
                        Text(inlineToAnnotated(item.inlines, accent, codeBg), style = body)
                    }
                }
            }
            is MdBlock.Table -> Column(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
                    .background(DfColors.Surface, RoundedCornerShape(10.dp)).padding(8.dp),
            ) {
                val rows = listOf(b.header) + b.rows
                rows.forEachIndexed { idx, row ->
                    Row {
                        row.forEach { cell ->
                            Text(
                                inlineToAnnotated(cell, accent, codeBg),
                                style = body.copy(
                                    fontSize = 13.sp,
                                    fontWeight = if (idx == 0) FontWeight.SemiBold else FontWeight.Normal,
                                ),
                                modifier = Modifier.widthIn(min = 72.dp, max = 220.dp).padding(6.dp),
                            )
                        }
                    }
                    if (idx == 0) HorizontalDivider(color = DfColors.Line)
                }
            }
            MdBlock.Rule -> HorizontalDivider(color = DfColors.Line)
        }
    }
}
