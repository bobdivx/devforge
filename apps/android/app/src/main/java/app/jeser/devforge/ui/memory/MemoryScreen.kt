package app.jeser.devforge.ui.memory

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.MemoryItem
import app.jeser.devforge.ui.components.ConfirmActionSheet
import app.jeser.devforge.ui.components.ConfirmSpec
import app.jeser.devforge.ui.components.relativeTime
import app.jeser.devforge.ui.theme.DfColors

/** Feuille ouverte sur l'écran Mémoire (confirmation ou correction). */
sealed interface MemorySheet {
    data class Edit(val item: MemoryItem) : MemorySheet
    data class Forget(val item: MemoryItem) : MemorySheet
    data class Pin(val item: MemoryItem) : MemorySheet
}

fun forgetConfirm(item: MemoryItem) = ConfirmSpec(
    emoji = "🧹",
    title = "Oublier ce souvenir ?",
    body = "« ${item.content.take(140)}${if (item.content.length > 140) "…" else ""} »\nTes agents ne s'en serviront plus.",
    confirmLabel = "Oublier",
    danger = true,
)

fun pinConfirm(item: MemoryItem) = if (item.pinned) {
    ConfirmSpec("📌", "Désépingler ?", "Ce souvenir pourra de nouveau expirer ou être remplacé automatiquement.", "Désépingler")
} else {
    ConfirmSpec("📌", "Épingler ce souvenir ?", "Il reste dans la mémoire tant que tu ne le retires pas : ni expiration, ni remplacement automatique.", "Épingler")
}

data class MemoryActions(
    val onBack: () -> Unit = {},
    val onTab: (MemoryTab) -> Unit = {},
    val onRetry: () -> Unit = {},
    val onCorrect: (String, String) -> Unit = { _, _ -> },
    val onForget: (String) -> Unit = {},
    val onPin: (String, Boolean) -> Unit = { _, _ -> },
    val onNoticeShown: () -> Unit = {},
)

/** Réglages → Mémoire : Profil / Journal / Notes, budget du profil, corriger / oublier / épingler. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MemoryScreen(state: MemoryUiState, actions: MemoryActions, initialSheet: MemorySheet? = null) {
    var sheet by remember { mutableStateOf(initialSheet) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.notice) {
        state.notice?.let { snackbar.showSnackbar(it); actions.onNoticeShown() }
    }
    // Action terminée (occupé → libre) : la feuille de confirmation se ferme.
    var wasBusy by remember { mutableStateOf(false) }
    LaunchedEffect(state.busy) {
        if (wasBusy && state.busy == null && sheet !is MemorySheet.Edit) sheet = null
        wasBusy = state.busy != null
    }
    Scaffold(
        containerColor = DfColors.Bg,
        topBar = {
            TopAppBar(
                title = { Text("Mémoire") },
                navigationIcon = {
                    IconButton(onClick = actions.onBack, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour aux réglages")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DfColors.Bg),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { padding ->
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = padding.calculateTopPadding() + 4.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize().testTag("memory-list"),
        ) {
            item(key = "tabs") { MemoryTabs(state.tab, actions.onTab) }
            item(key = "hint") { Text(state.tab.hint, color = DfColors.InkMuted, fontSize = 13.sp) }
            if (state.tab == MemoryTab.Profile) item(key = "budget") { BudgetBar(state.budget.used, state.budget.max) }
            when {
                state.loading -> item(key = "loading") {
                    Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = DfColors.Accent) }
                }
                state.error != null && state.items.isEmpty() -> item(key = "error") {
                    MemoryCard {
                        Text("Mémoire illisible", fontWeight = FontWeight.Medium)
                        Text(state.error, color = DfColors.InkMuted, fontSize = 13.sp)
                        TextButton(onClick = actions.onRetry, modifier = Modifier.heightIn(min = 48.dp)) { Text("Réessayer") }
                    }
                }
                state.items.isEmpty() -> item(key = "empty") {
                    MemoryCard {
                        Text("Rien pour l'instant", fontWeight = FontWeight.Medium)
                        Text(
                            when (state.tab) {
                                MemoryTab.Profile -> "Dis à Braise « retiens que… » : ça apparaîtra ici."
                                MemoryTab.Log -> "Les déploiements et décisions importantes s'inscriront ici."
                                MemoryTab.Note -> "Les notes de travail des agents apparaissent ici puis expirent."
                            },
                            color = DfColors.InkMuted, fontSize = 13.sp,
                        )
                    }
                }
                else -> items(state.items, key = { it.uuid }) { item ->
                    MemoryRow(
                        item = item,
                        busy = state.busy == item.uuid,
                        onEdit = { sheet = MemorySheet.Edit(item) },
                        onForget = { sheet = MemorySheet.Forget(item) },
                        onPin = { sheet = MemorySheet.Pin(item) },
                    )
                }
            }
        }
    }
    when (val s = sheet) {
        is MemorySheet.Forget -> ConfirmActionSheet(forgetConfirm(s.item), busy = state.busy == s.item.uuid, onDismiss = { sheet = null }) {
            actions.onForget(s.item.uuid)
        }
        is MemorySheet.Pin -> ConfirmActionSheet(pinConfirm(s.item), busy = state.busy == s.item.uuid, onDismiss = { sheet = null }) {
            actions.onPin(s.item.uuid, !s.item.pinned)
        }
        is MemorySheet.Edit -> EditSheet(s.item, busy = state.busy == s.item.uuid, onDismiss = { sheet = null }) { text ->
            actions.onCorrect(s.item.uuid, text)
            sheet = null
        }
        null -> Unit
    }
}

@Composable
private fun MemoryTabs(selected: MemoryTab, onTab: (MemoryTab) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        MemoryTab.entries.forEach { t ->
            val on = t == selected
            Surface(
                onClick = { onTab(t) },
                shape = RoundedCornerShape(12.dp),
                color = if (on) DfColors.AccentSoft else DfColors.Card,
                border = BorderStroke(1.dp, if (on) DfColors.Accent.copy(alpha = .5f) else DfColors.Line),
                modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("memory-tab-${t.key}")
                    .semantics { role = Role.Tab; this.selected = on },
            ) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(t.label, color = if (on) DfColors.Ink else DfColors.InkMuted, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
                }
            }
        }
    }
}

@Composable
private fun BudgetBar(used: Int, max: Int) {
    val (pct, tone) = memoryBudgetState(used, max)
    val color = when (tone) {
        BudgetTone.Ok -> DfColors.Accent
        BudgetTone.Warn -> DfColors.Warn
        BudgetTone.Danger -> DfColors.Danger
    }
    MemoryCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Taille du profil", fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            Text("$used / $max car.", color = if (tone == BudgetTone.Ok) DfColors.InkMuted else color, fontSize = 13.sp)
        }
        LinearProgressIndicator(
            progress = { pct / 100f },
            color = color,
            trackColor = DfColors.Line,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp).semantics { contentDescription = "Profil rempli à $pct %" }.testTag("memory-budget"),
        )
        if (tone != BudgetTone.Ok) {
            Text(
                if (tone == BudgetTone.Danger) "Profil trop long : les plus anciens souvenirs non épinglés ne sont plus lus." else "Profil presque plein : fais le tri.",
                color = color, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

@Composable
private fun MemoryCard(tone: Color? = null, content: @Composable () -> Unit) {
    Surface(
        color = DfColors.Card,
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, tone?.copy(alpha = .4f) ?: DfColors.Line),
        modifier = Modifier.fillMaxWidth(),
    ) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { content() } }
}

@Composable
private fun MemoryRow(item: MemoryItem, busy: Boolean, onEdit: () -> Unit, onForget: () -> Unit, onPin: () -> Unit) {
    MemoryCard(tone = if (item.pinned) DfColors.Accent else null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                (MEMORY_KIND_LABELS[item.kind] ?: item.kind) + " · " + memoryScopeLabel(item),
                color = DfColors.InkFaint, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
            if (item.pinned) Icon(Icons.Filled.PushPin, contentDescription = "Épinglé", tint = DfColors.Accent, modifier = Modifier.size(16.dp))
        }
        Text(item.content, color = DfColors.Ink, fontSize = 15.sp)
        val meta = listOfNotNull(memorySourceLabel(item), relativeTime(item.updatedAt).ifBlank { null }, untilLabel(item.expiresAt))
        Text(meta.joinToString(" · "), color = DfColors.InkFaint, fontSize = 12.sp)
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
            RowAction(if (item.pinned) "Désépingler" else "Épingler", if (item.pinned) Icons.Filled.PushPin else Icons.Outlined.PushPin, DfColors.InkMuted, !busy, onPin)
            RowAction("Corriger", Icons.Filled.Edit, DfColors.InkMuted, !busy, onEdit)
            Spacer(Modifier.weight(1f))
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = DfColors.Accent)
            RowAction("Oublier", Icons.Filled.Delete, DfColors.Danger, !busy, onForget)
        }
    }
}

@Composable
private fun RowAction(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color, enabled: Boolean, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        contentPadding = PaddingValues(horizontal = 8.dp),
        modifier = Modifier.heightIn(min = 48.dp).widthIn(min = 48.dp),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
        Text(label, color = tint, fontSize = 13.sp, maxLines = 1, softWrap = false, modifier = Modifier.padding(start = 4.dp))
    }
}

private fun untilLabel(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    val t = runCatching { java.time.OffsetDateTime.parse(iso).toInstant().toEpochMilli() }.getOrNull() ?: return null
    val min = (t - System.currentTimeMillis()) / 60000
    return when {
        min <= 0 -> "expirée"
        min < 60 -> "expire dans $min min"
        min < 48 * 60 -> "expire dans ${min / 60} h"
        else -> "expire dans ${min / 1440} j"
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditSheet(item: MemoryItem, busy: Boolean, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var text by remember(item.uuid) { mutableStateOf(item.content) }
    val changed = text.trim().isNotEmpty() && text.trim() != item.content.trim()
    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = sheetState, containerColor = DfColors.Surface) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Corriger le souvenir", style = MaterialTheme.typography.titleLarge)
            Text("L'ancienne version reste dans l'historique (web).", color = DfColors.InkMuted, fontSize = 13.sp)
            OutlinedTextField(
                value = text,
                onValueChange = { if (it.length <= 1000) text = it },
                minLines = 3,
                maxLines = 8,
                modifier = Modifier.fillMaxWidth().testTag("memory-edit-field"),
                supportingText = { Text("${text.length} / 1000") },
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text("Annuler") }
                Button(onClick = { onSave(text.trim()) }, enabled = !busy && changed, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text("Enregistrer") }
            }
        }
    }
}
