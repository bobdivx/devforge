package app.jeser.devforge.ui.receipts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.jeser.devforge.AppGraph
import app.jeser.devforge.data.ApprovalReceipt
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class ReceiptTone { Ok, Danger, Warn, Accent, Neutral }

/** Libellé + ton d'une issue (mêmes mots que le web). */
fun receiptStatusLabel(status: String): Pair<String, ReceiptTone> = when (status) {
    "done" -> "Réussi" to ReceiptTone.Ok
    "failed" -> "Échec" to ReceiptTone.Danger
    "unknown" -> "Issue inconnue" to ReceiptTone.Warn
    "executing" -> "En cours" to ReceiptTone.Accent
    "pending" -> "En attente" to ReceiptTone.Neutral
    "approved" -> "Validé" to ReceiptTone.Accent
    "expired" -> "Expiré" to ReceiptTone.Neutral
    else -> status to ReceiptTone.Neutral
}

fun receiptSourceLabel(source: String): String = when (source) {
    "web" -> "Web"
    "android" -> "Android"
    "agent" -> "Agent"
    "api" -> "API"
    else -> source
}

/** Pastilles de filtre : zéro réglage. `statuses` = filtre serveur. */
enum class ReceiptFilter(val label: String, val statuses: String?) {
    All("Tout", null),
    Problems("À vérifier", "failed,unknown"),
    Waiting("En attente", "pending,approved,executing"),
    Done("Réussis", "done"),
}

fun shortVersion(v: String?): String? {
    val s = v?.trim().orEmpty()
    if (s.isEmpty()) return null
    return if (Regex("^[0-9a-fA-F]{12,40}$").matches(s)) s.take(7) else s
}

/** « Projet · par Mathieu ». */
fun receiptSubtitle(r: ApprovalReceipt): String {
    val project = r.projectName?.takeIf { it.isNotBlank() } ?: r.target
    val who = r.approvedByLabel?.takeIf { it.isNotBlank() }
    return if (who != null) "$project · par $who" else project
}

/** Heure lisible en Europe/Paris (ex. « 25 oct. 14:05 »). */
fun receiptWhen(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    return runCatching {
        val t = java.time.OffsetDateTime.parse(iso).atZoneSameInstant(java.time.ZoneId.of("Europe/Paris"))
        java.time.format.DateTimeFormatter.ofPattern("d MMM HH:mm", java.util.Locale.FRENCH).format(t)
    }.getOrNull()
}

/** Lignes du détail, sans champ vide. */
fun receiptDetails(r: ApprovalReceipt): List<Pair<String, String>> = listOf(
    "Action" to r.actionLabel,
    "Cible" to r.target,
    "Projet" to r.projectName,
    "Version" to shortVersion(r.version),
    "Validé par" to r.approvedByLabel,
    "Validé le" to receiptWhen(r.approvedAt),
    "Depuis" to receiptSourceLabel(r.source),
    "Lancé le" to receiptWhen(r.consumedAt),
    "Terminé le" to receiptWhen(r.finishedAt),
    "Outil" to r.toolName,
    "Empreinte" to r.actionHash.take(12).ifBlank { null },
).mapNotNull { (k, v) -> v?.takeIf { it.isNotBlank() }?.let { k to it } }

data class ReceiptsUiState(
    val filter: ReceiptFilter = ReceiptFilter.All,
    val items: List<ApprovalReceipt> = emptyList(),
    val nextBefore: String? = null,
    val loading: Boolean = true,
    val loadingMore: Boolean = false,
    val error: String? = null,
)

class ReceiptsViewModel(private val graph: AppGraph) : ViewModel() {
    private val _state = MutableStateFlow(ReceiptsUiState())
    val state: StateFlow<ReceiptsUiState> = _state

    fun load(filter: ReceiptFilter = _state.value.filter) {
        _state.update { it.copy(filter = filter, loading = it.filter != filter || it.items.isEmpty(), error = null) }
        viewModelScope.launch {
            runCatching { graph.api.receipts(filter.statuses) }
                .onSuccess { list ->
                    if (_state.value.filter == filter) {
                        _state.update { it.copy(items = list.data, nextBefore = list.nextBefore, loading = false) }
                    }
                }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message ?: "Instance injoignable") } }
        }
    }

    fun more() {
        val s = _state.value
        val before = s.nextBefore ?: return
        if (s.loadingMore) return
        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            runCatching { graph.api.receipts(s.filter.statuses, before) }
                .onSuccess { list ->
                    _state.update { it.copy(items = it.items + list.data, nextBefore = list.nextBefore, loadingMore = false) }
                }
                .onFailure { _state.update { it.copy(loadingMore = false) } }
        }
    }

    /** Détail frais (l'issue d'un déploiement a pu changer). */
    suspend fun fresh(uuid: String): ApprovalReceipt? = runCatching { graph.api.receipt(uuid) }.getOrNull()
}
