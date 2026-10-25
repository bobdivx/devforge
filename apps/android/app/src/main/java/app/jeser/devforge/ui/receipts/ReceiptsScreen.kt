package app.jeser.devforge.ui.receipts

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.ApprovalReceipt
import app.jeser.devforge.ui.theme.DfColors

fun toneColor(t: ReceiptTone): Color = when (t) {
    ReceiptTone.Ok -> DfColors.Ok
    ReceiptTone.Danger -> DfColors.Danger
    ReceiptTone.Warn -> DfColors.Warn
    ReceiptTone.Accent -> DfColors.Accent
    ReceiptTone.Neutral -> DfColors.InkFaint
}

data class ReceiptsActions(
    val onBack: () -> Unit = {},
    val onFilter: (ReceiptFilter) -> Unit = {},
    val onRetry: () -> Unit = {},
    val onMore: () -> Unit = {},
    val loadDetail: suspend (String) -> ApprovalReceipt? = { null },
)

/** Réglages → Validations : liste des reçus, détail dans une feuille. Lecture seule. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReceiptsScreen(state: ReceiptsUiState, actions: ReceiptsActions, initialOpen: ApprovalReceipt? = null) {
    var open by remember { mutableStateOf(initialOpen) }
    Scaffold(
        containerColor = DfColors.Bg,
        topBar = {
            TopAppBar(
                title = { Text("Validations") },
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
            modifier = Modifier.fillMaxSize().testTag("receipts-list"),
        ) {
            item(key = "filters") { Filters(state.filter, actions.onFilter) }
            item(key = "hint") {
                Text("Chaque action risquée confirmée : qui, quand, quoi, et l'issue.", color = DfColors.InkMuted, fontSize = 13.sp)
            }
            when {
                state.loading -> item(key = "loading") {
                    Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = DfColors.Accent) }
                }
                state.error != null && state.items.isEmpty() -> item(key = "error") {
                    Tile {
                        Text("Historique illisible", fontWeight = FontWeight.Medium)
                        Text(state.error, color = DfColors.InkMuted, fontSize = 13.sp)
                        TextButton(onClick = actions.onRetry, modifier = Modifier.heightIn(min = 48.dp)) { Text("Réessayer") }
                    }
                }
                state.items.isEmpty() -> item(key = "empty") {
                    Tile {
                        Text("Rien pour l'instant", fontWeight = FontWeight.Medium)
                        Text(
                            if (state.filter == ReceiptFilter.All) "Chaque mise en ligne, arrêt ou publication confirmé apparaîtra ici." else "Rien dans ce filtre.",
                            color = DfColors.InkMuted, fontSize = 13.sp,
                        )
                    }
                }
                else -> {
                    items(state.items, key = { it.uuid }) { r -> ReceiptRow(r) { open = r } }
                    if (state.nextBefore != null) item(key = "more") {
                        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                            TextButton(onClick = actions.onMore, enabled = !state.loadingMore, modifier = Modifier.heightIn(min = 48.dp)) {
                                Text(if (state.loadingMore) "Chargement…" else "Voir plus")
                            }
                        }
                    }
                }
            }
        }
    }
    open?.let { r ->
        var shown by remember(r.uuid) { mutableStateOf(r) }
        LaunchedEffect(r.uuid) { actions.loadDetail(r.uuid)?.let { shown = it } }
        ReceiptSheet(shown) { open = null }
    }
}

@Composable
private fun Filters(selected: ReceiptFilter, onFilter: (ReceiptFilter) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ReceiptFilter.entries.forEach { f ->
            val on = f == selected
            Surface(
                onClick = { onFilter(f) },
                shape = RoundedCornerShape(24.dp),
                color = if (on) DfColors.AccentSoft else DfColors.Card,
                border = BorderStroke(1.dp, if (on) DfColors.Accent.copy(alpha = .5f) else DfColors.Line),
                modifier = Modifier.heightIn(min = 48.dp).testTag("receipts-filter-${f.name.lowercase()}")
                    .semantics { role = Role.Tab; this.selected = on },
            ) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.heightIn(min = 48.dp).padding(horizontal = 16.dp)) {
                    Text(f.label, color = if (on) DfColors.Ink else DfColors.InkMuted, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1)
                }
            }
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

@Composable
private fun ReceiptRow(r: ApprovalReceipt, onClick: () -> Unit) {
    val (label, tone) = receiptStatusLabel(r.status)
    Tile(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = 24.dp)) {
            Box(Modifier.size(10.dp).background(toneColor(tone), CircleShape))
            Text(
                r.actionLabel.ifBlank { r.action },
                fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(start = 10.dp),
            )
            Text(label, color = toneColor(tone), fontSize = 13.sp, maxLines = 1)
        }
        Text(receiptSubtitle(r), color = DfColors.InkMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            listOfNotNull(receiptWhen(r.approvedAt ?: r.createdAt), receiptSourceLabel(r.source)).joinToString(" · "),
            color = DfColors.InkFaint, fontSize = 12.sp,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReceiptSheet(r: ApprovalReceipt, onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val (label, tone) = receiptStatusLabel(r.status)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = DfColors.Surface) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 20.dp).navigationBarsPadding()
                .testTag("receipt-sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(r.actionLabel.ifBlank { r.action }, style = MaterialTheme.typography.titleLarge)
            Surface(shape = RoundedCornerShape(10.dp), color = toneColor(tone).copy(alpha = .14f)) {
                Text(label, color = toneColor(tone), fontWeight = FontWeight.Medium, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
            }
            r.detail?.takeIf { it.isNotBlank() }?.let {
                Text(it, color = if (tone == ReceiptTone.Danger || tone == ReceiptTone.Warn) toneColor(tone) else DfColors.InkMuted, fontSize = 14.sp)
            }
            if (r.status == "unknown") {
                Text(
                    "DevForge a redémarré pendant l'action : elle n'a pas été relancée. Vérifie le résultat avant de recommencer.",
                    color = DfColors.InkMuted, fontSize = 13.sp,
                )
            }
            Surface(color = DfColors.Card, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, DfColors.Line)) {
                Column {
                    receiptDetails(r).forEachIndexed { i, (k, v) ->
                        if (i > 0) HorizontalDivider(color = DfColors.Line)
                        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(k, color = DfColors.InkMuted, fontSize = 13.sp, modifier = Modifier.padding(end = 12.dp))
                            Text(v, color = DfColors.Ink, fontSize = 14.sp, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}
