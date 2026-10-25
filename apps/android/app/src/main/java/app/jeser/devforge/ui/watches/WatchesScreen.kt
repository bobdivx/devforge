package app.jeser.devforge.ui.watches

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.PageWatch
import app.jeser.devforge.data.WatchCheck
import app.jeser.devforge.ui.components.ConfirmActionSheet
import app.jeser.devforge.ui.components.ConfirmSpec
import app.jeser.devforge.ui.theme.DfColors

fun watchToneColor(t: WatchTone): Color = when (t) {
    WatchTone.Ok -> DfColors.Ok
    WatchTone.Danger -> DfColors.Danger
    WatchTone.Warn -> DfColors.Warn
    WatchTone.Accent -> DfColors.Accent
    WatchTone.Neutral -> DfColors.InkFaint
}

data class WatchesActions(
    val onBack: () -> Unit = {},
    val onRetry: () -> Unit = {},
    val onOpen: (PageWatch) -> Unit = {},
    val onClose: () -> Unit = {},
    val onRun: () -> Unit = {},
    val onPause: () -> Unit = {},
    val onResume: () -> Unit = {},
    val onAskDelete: () -> Unit = {},
    val onCancelDelete: () -> Unit = {},
    val onDelete: () -> Unit = {},
)

/** Réglages → Surveillance : tuiles des pages surveillées, détail et actions dans une feuille. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WatchesScreen(state: WatchesUiState, actions: WatchesActions) {
    Scaffold(
        containerColor = DfColors.Bg,
        topBar = {
            TopAppBar(
                title = { Text("Surveillance") },
                navigationIcon = {
                    IconButton(onClick = actions.onBack, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour aux réglages")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DfColors.Bg),
            )
        },
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { padding ->
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = padding.calculateTopPadding() + 4.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize().testTag("watches-list"),
        ) {
            item(key = "hint") {
                Text("Une page change, un texte apparaît ou un prix passe un seuil : tu es prévenu.", color = DfColors.InkMuted, fontSize = 13.sp)
            }
            when {
                state.loading -> item(key = "loading") {
                    Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = DfColors.Accent) }
                }
                state.error != null && state.items.isEmpty() -> item(key = "error") {
                    Tile {
                        Text("Liste illisible", fontWeight = FontWeight.Medium)
                        Text(state.error, color = DfColors.InkMuted, fontSize = 13.sp)
                        TextButton(onClick = actions.onRetry, modifier = Modifier.heightIn(min = 48.dp)) { Text("Réessayer") }
                    }
                }
                state.items.isEmpty() -> item(key = "empty") {
                    Tile {
                        Text("Aucune page surveillée", fontWeight = FontWeight.Medium)
                        Text("Ajoute-en une depuis le site : Réglages → Surveillance → Nouvelle.", color = DfColors.InkMuted, fontSize = 13.sp)
                    }
                }
                else -> items(state.items, key = { it.uuid }) { w -> WatchRow(w) { actions.onOpen(w) } }
            }
        }
    }
    state.open?.let { w ->
        if (state.confirmDelete) {
            ConfirmActionSheet(
                spec = ConfirmSpec(
                    emoji = "🗑️",
                    title = "Supprimer « ${w.name} » ?",
                    body = "La surveillance et son historique seront effacés. La page elle-même n'est pas touchée.",
                    confirmLabel = "Supprimer",
                    danger = true,
                ),
                busy = state.busy == "delete",
                onDismiss = actions.onCancelDelete,
                onConfirm = actions.onDelete,
            )
        } else {
            WatchSheet(w, state.checks, state.busy, state.actionError, actions)
        }
    }
}

@Composable
private fun Tile(onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    val body: @Composable () -> Unit = { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { content() } }
    if (onClick != null) {
        Surface(onClick = onClick, color = DfColors.Card, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, DfColors.Line), modifier = Modifier.fillMaxWidth()) { body() }
    } else {
        Surface(color = DfColors.Card, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, DfColors.Line), modifier = Modifier.fillMaxWidth()) { body() }
    }
}

private fun kindEmoji(kind: String) = when (kind) {
    "text" -> "🔎"
    "price" -> "🏷️"
    else -> "👁️"
}

@Composable
private fun WatchRow(w: PageWatch, onClick: () -> Unit) {
    val (label, tone) = watchStatus(w)
    Tile(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = 24.dp)) {
            Text(kindEmoji(w.kind), fontSize = 18.sp)
            Text(
                w.name.ifBlank { watchHost(w.url) },
                fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(start = 10.dp),
            )
            Box(Modifier.size(8.dp).background(watchToneColor(tone), CircleShape))
            Text(label, color = watchToneColor(tone), fontSize = 13.sp, maxLines = 1, modifier = Modifier.padding(start = 6.dp))
        }
        Text(watchSubtitle(w), color = DfColors.InkMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            listOfNotNull(watchHost(w.url), "toutes les ${intervalLabel(w.intervalMinutes)}").joinToString(" · "),
            color = DfColors.InkFaint, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WatchSheet(w: PageWatch, checks: List<WatchCheck>, busy: String?, error: String?, actions: WatchesActions) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val (label, tone) = watchStatus(w)
    val uri = LocalUriHandler.current
    ModalBottomSheet(onDismissRequest = actions.onClose, sheetState = sheetState, containerColor = DfColors.Surface) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 20.dp).navigationBarsPadding()
                .testTag("watch-sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(w.name.ifBlank { watchHost(w.url) }, style = MaterialTheme.typography.titleLarge)
            Surface(shape = RoundedCornerShape(10.dp), color = watchToneColor(tone).copy(alpha = .14f)) {
                Text(label, color = watchToneColor(tone), fontWeight = FontWeight.Medium, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
            }
            w.lastError?.takeIf { it.isNotBlank() && (w.failureStreak > 0 || w.status == "paused") }?.let {
                Text(it, color = DfColors.Danger, fontSize = 14.sp)
            }
            w.lastSummary?.takeIf { it.isNotBlank() }?.let { Text(it, color = DfColors.InkMuted, fontSize = 14.sp) }
            Surface(color = DfColors.Card, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, DfColors.Line)) {
                Column {
                    watchDetails(w).forEachIndexed { i, (k, v) ->
                        if (i > 0) HorizontalDivider(color = DfColors.Line)
                        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(k, color = DfColors.InkMuted, fontSize = 13.sp, modifier = Modifier.padding(end = 12.dp))
                            Text(v, color = DfColors.Ink, fontSize = 14.sp, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
            TextButton(onClick = { runCatching { uri.openUri(w.url) } }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text("Ouvrir la page · ${watchHost(w.url)}", maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            error?.let { Text(it, color = DfColors.Danger, fontSize = 13.sp) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                if (w.status == "paused") {
                    Button(onClick = actions.onResume, enabled = busy == null, modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("watch-resume")) {
                        Text(if (busy == "resume") "Reprise…" else "Reprendre")
                    }
                } else {
                    Button(onClick = actions.onRun, enabled = busy == null, modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("watch-run")) {
                        Text(if (busy == "run") "Vérification…" else "Vérifier")
                    }
                    OutlinedButton(onClick = actions.onPause, enabled = busy == null, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                        Text("Pause")
                    }
                }
            }
            TextButton(onClick = actions.onAskDelete, enabled = busy == null, modifier = Modifier.heightIn(min = 48.dp).testTag("watch-delete")) {
                Text("Supprimer", color = DfColors.Danger)
            }
            if (checks.isNotEmpty()) {
                Text("Dernières vérifications", fontWeight = FontWeight.SemiBold)
                Surface(color = DfColors.Card, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, DfColors.Line)) {
                    Column {
                        checks.take(10).forEachIndexed { i, c ->
                            if (i > 0) HorizontalDivider(color = DfColors.Line)
                            val (cl, ct) = checkOutcome(c.outcome)
                            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(cl, color = watchToneColor(ct), fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                                    Text(watchWhen(c.checkedAt).orEmpty(), color = DfColors.InkFaint, fontSize = 12.sp)
                                }
                                (c.error ?: c.summary ?: c.value)?.takeIf { it.isNotBlank() }?.let {
                                    Text(it, color = DfColors.InkMuted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
