package app.jeser.devforge.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import app.jeser.devforge.ui.theme.DfColors
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/**
 * Feuille « de navigation » (Braise, Workspace, brouillon, déploiements, réglages de l'app, logs…)
 * dessinée dans la zone de contenu : la barre Apps / Braise / Réglages reste visible et utilisable dessous.
 * Les confirmations (arrêter, publier, jeter…) restent des feuilles modales classiques.
 * À appeler au niveau racine de l'écran (dans un Box plein écran).
 */
@Composable
fun NavSheet(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    BackHandler(onBack = onDismissRequest)
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    // Glissement d'entrée + glisser la poignée vers le bas pour fermer.
    val offset = remember { Animatable(0f) }
    val appear = remember { Animatable(0f) }
    LaunchedEffect(Unit) { appear.animateTo(1f, tween(180)) }
    Box(
        Modifier.fillMaxSize().testTag("nav-sheet")
            .windowInsetsPadding(WindowInsets.statusBars).imePadding(),
    ) {
        Box(
            Modifier.fillMaxSize()
                .graphicsLayer { alpha = appear.value }
                .background(Color.Black.copy(alpha = .45f))
                .pointerInput(Unit) { detectTapGestures { onDismissRequest() } },
        )
        BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
            val maxH = maxHeight * 0.94f
            val dismissPx = with(density) { 120.dp.toPx() }
            Surface(
                color = DfColors.Surface,
                shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
                modifier = modifier.fillMaxWidth().widthIn(max = 640.dp).heightIn(max = maxH)
                    .offset { IntOffset(0, offset.value.roundToInt()) }
                    .graphicsLayer { translationY = (1f - appear.value) * 60.dp.toPx() },
            ) {
                Column {
                    Box(
                        Modifier.fillMaxWidth().height(28.dp)
                            .draggable(
                                orientation = Orientation.Vertical,
                                state = rememberDraggableState { d -> scope.launch { offset.snapTo((offset.value + d).coerceAtLeast(0f)) } },
                                onDragStopped = {
                                    if (offset.value > dismissPx) onDismissRequest() else scope.launch { offset.animateTo(0f) }
                                },
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(Modifier.size(width = 32.dp, height = 4.dp).background(DfColors.InkMuted.copy(alpha = .5f), RoundedCornerShape(2.dp)))
                    }
                    Column(Modifier.padding(bottom = 4.dp), content = content)
                }
            }
        }
    }
}
