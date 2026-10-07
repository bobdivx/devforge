package app.jeser.devforge.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Palette du web DevForge (fond zinc très sombre, accent violet). */
object DfColors {
    val Bg = Color(0xFF09090B)
    val BgElevated = Color(0xFF0F0F12)
    val Surface = Color(0xFF141418)
    val Surface2 = Color(0xFF1A1A20)
    val Card = Color(0xFF121216)
    val Ink = Color(0xFFFAFAFA)
    val InkMuted = Color(0xFFA1A1AA)
    val InkFaint = Color(0xFF71717A)
    val Line = Color(0x14FFFFFF)
    val LineStrong = Color(0x24FFFFFF)
    val Accent = Color(0xFFA78BFA)
    val Accent2 = Color(0xFFE879F9)
    val AccentSoft = Color(0x1FA78BFA)
    val Ok = Color(0xFF4ADE80)
    val Warn = Color(0xFFFBBF24)
    val Danger = Color(0xFFF87171)
    val OnAccent = Color(0xFF09090B)
}

private val scheme = darkColorScheme(
    primary = DfColors.Accent,
    onPrimary = DfColors.OnAccent,
    primaryContainer = Color(0xFF2E1065),
    onPrimaryContainer = Color(0xFFEDE9FE),
    secondary = DfColors.Accent2,
    onSecondary = DfColors.OnAccent,
    background = DfColors.Bg,
    onBackground = DfColors.Ink,
    surface = DfColors.Bg,
    onSurface = DfColors.Ink,
    surfaceVariant = DfColors.Surface,
    onSurfaceVariant = DfColors.InkMuted,
    surfaceContainerLowest = DfColors.Bg,
    surfaceContainerLow = DfColors.Card,
    surfaceContainer = DfColors.Surface,
    surfaceContainerHigh = DfColors.Surface2,
    surfaceContainerHighest = Color(0xFF222229),
    outline = DfColors.LineStrong,
    outlineVariant = DfColors.Line,
    error = DfColors.Danger,
    onError = DfColors.OnAccent,
    scrim = Color(0xCC000000),
)

private val base = Typography()
private val typography = base.copy(
    headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.3).sp),
    titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp),
    titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
    labelLarge = base.labelLarge.copy(fontWeight = FontWeight.SemiBold),
)

@Composable
fun DevForgeTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = typography, content = content)
}

val MonoSmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp)
