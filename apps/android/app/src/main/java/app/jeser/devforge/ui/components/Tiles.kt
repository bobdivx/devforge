package app.jeser.devforge.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.AppStatus
import app.jeser.devforge.data.PersonaKey
import app.jeser.devforge.data.Tone
import app.jeser.devforge.data.appIconCandidates
import app.jeser.devforge.data.iconInitials
import app.jeser.devforge.data.iconPaletteIndex
import app.jeser.devforge.ui.theme.DfColors
import coil.compose.AsyncImage
import coil.request.ImageRequest

/** Fond des tuiles : le même gris que les HubTile du web (#1c1c1e). */
val TileBg = Color(0xFF1C1C1E)

/** false dans les captures et aperçus : initiales seulement (pas de réseau). */
val LocalLoadRemoteIcons = compositionLocalOf { true }

/**
 * Tuile DevForge (HubTile) : icône, titre, statut, au plus un interrupteur.
 * Toute info ou action supplémentaire s'ouvre dans une feuille, jamais sous la grille.
 */
@Composable
fun DfTile(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    tone: Color? = null,
    minHeight: Dp = 140.dp,
    contentDescription: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        onClick = onClick,
        color = if (selected) Color(0xFF26222F) else TileBg,
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, tone?.copy(alpha = .35f) ?: if (selected) DfColors.Accent.copy(alpha = .5f) else Color.Transparent),
        modifier = modifier.fillMaxWidth().heightIn(min = minHeight).let { m ->
            if (contentDescription != null) {
                m.then(Modifier.semanticsLabel(contentDescription))
            } else m
        },
    ) {
        Column(
            Modifier.padding(horizontal = 10.dp, vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
            content = content,
        )
    }
}

private fun Modifier.semanticsLabel(label: String): Modifier =
    this.then(Modifier.semantics(mergeDescendants = true) { contentDescription = label })

private val PALETTES = listOf(
    Color(0xFF0EA5E9) to Color(0xFF1D4ED8),
    Color(0xFF10B981) to Color(0xFF0F766E),
    Color(0xFFF59E0B) to Color(0xFFC2410C),
    Color(0xFFF43F5E) to Color(0xFFBE185D),
    Color(0xFF8B5CF6) to Color(0xFF4338CA),
    Color(0xFF22D3EE) to Color(0xFF0E7490),
    Color(0xFF84CC16) to Color(0xFF15803D),
    Color(0xFFD946EF) to Color(0xFF6B21A8),
)
private val PALETTE_FG = listOf(
    Color(0xFFE0F2FE), Color(0xFFD1FAE5), Color(0xFFFFEDD5), Color(0xFFFFE4E6),
    Color(0xFFEDE9FE), Color(0xFFCFFAFE), Color(0xFFECFCCB), Color(0xFFFAE8FF),
)

/**
 * Icône d'app comme sur le web : apple-touch-icon / favicon du site, puis services, puis avatar GitHub ;
 * à défaut, initiales sur un dégradé. L'anneau et la pastille donnent le statut.
 */
@Composable
fun AppIcon(
    name: String,
    productionUrl: String?,
    gitRepository: String?,
    status: AppStatus?,
    size: Dp = 64.dp,
    modifier: Modifier = Modifier,
) {
    val candidates = remember(productionUrl, gitRepository) { appIconCandidates(productionUrl, gitRepository) }
    var idx by remember(candidates) { mutableIntStateOf(0) }
    val remote = LocalLoadRemoteIcons.current
    val src = if (remote) candidates.getOrNull(idx) else null
    val corner = RoundedCornerShape(size * 0.28f)
    val ring = status?.color()
    val pi = iconPaletteIndex(name)
    Box(modifier.size(size + 8.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(size + 8.dp)
                .let { if (ring != null) it.border(2.dp, ring.copy(alpha = .75f), RoundedCornerShape(size * 0.34f)) else it },
        )
        Box(
            Modifier.size(size).clip(corner).background(
                if (src == null) Brush.linearGradient(listOf(PALETTES[pi].first, PALETTES[pi].second))
                else Brush.linearGradient(listOf(Color(0xFF2A2A2E), Color(0xFF2A2A2E))),
            ),
            contentAlignment = Alignment.Center,
        ) {
            if (src != null) {
                AsyncImage(
                    model = ImageRequest.Builder(LocalContext.current).data(src).crossfade(true).build(),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    onError = { idx += 1 },
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Text(
                    iconInitials(name),
                    color = PALETTE_FG[pi],
                    fontWeight = FontWeight.SemiBold,
                    fontSize = (size.value * 0.32f).sp,
                )
            }
        }
        if (ring != null) {
            Box(
                Modifier.align(Alignment.TopEnd).offset(x = (-1).dp, y = 1.dp).size(14.dp)
                    .background(DfColors.Bg, CircleShape).padding(2.dp).background(ring, CircleShape),
            )
        }
    }
}

fun Tone.color(): Color = when (this) {
    Tone.Ok -> DfColors.Ok
    Tone.Warn -> DfColors.Warn
    Tone.Danger -> DfColors.Danger
    Tone.Accent -> DfColors.Accent
    Tone.Neutral -> DfColors.InkFaint
}

fun PersonaKey.persona(): Persona = when (this) {
    PersonaKey.Braise -> Persona.Braise
    PersonaKey.Phare -> Persona.Phare
    PersonaKey.Rustine -> Persona.Rustine
    PersonaKey.Plume -> Persona.Plume
}

/** Petit libellé de tuile (« État », « Domaine »…). */
@Composable
fun TileLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), color = DfColors.InkFaint, fontSize = 10.5.sp, letterSpacing = .6.sp, fontWeight = FontWeight.SemiBold, modifier = modifier)
}
