package app.jeser.devforge.ui.memory

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.jeser.devforge.AppGraph
import app.jeser.devforge.data.MemoryBudget
import app.jeser.devforge.data.MemoryItem
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Onglets de la mémoire (mêmes libellés que le web). */
enum class MemoryTab(val key: String, val label: String, val hint: String) {
    Profile("profile", "Profil", "Toujours lu par tes agents : préférences, machines, conventions."),
    Log("log", "Journal", "Décisions, incidents et déploiements datés. Retrouvés quand c'est utile."),
    Note("note", "Notes", "Contexte court d'un fil (« déjà tenté », hypothèses). Expire tout seul."),
}

val MEMORY_KIND_LABELS = mapOf(
    "fact" to "Fait",
    "preference" to "Préférence",
    "infra" to "Infra",
    "decision" to "Décision",
    "incident" to "Incident",
    "todo" to "À faire",
    "context" to "Contexte",
)

/** « dit par toi » / « déduit par Braise » / « noté par DevForge ». */
fun memorySourceLabel(item: MemoryItem): String {
    if (item.createdBy == "user" || (item.source == "user_said" && !item.createdBy.startsWith("agent"))) return "dit par toi"
    if (item.createdBy == "system" || item.source == "system") return "noté par DevForge"
    val who = item.createdByName ?: "Braise"
    if (item.source == "user_said") return "retenu par $who (tu l'as dit)"
    return "${if (item.inferred) "déduit" else "noté"} par $who"
}

fun memoryScopeLabel(item: MemoryItem): String = when (item.scope) {
    "user" -> "Toutes tes apps"
    "project" -> item.projectName ?: "Une app"
    else -> item.agentName?.let { "Fil · $it" } ?: "Un fil"
}

enum class BudgetTone { Ok, Warn, Danger }

/** Part du budget du profil utilisée (0–100) et ton de la barre. */
fun memoryBudgetState(used: Int, max: Int): Pair<Int, BudgetTone> {
    val pct = if (max > 0) minOf(100, Math.round(used * 100f / max)) else 0
    val tone = when {
        used > max -> BudgetTone.Danger
        pct >= 85 -> BudgetTone.Warn
        else -> BudgetTone.Ok
    }
    return pct to tone
}

data class MemoryUiState(
    val tab: MemoryTab = MemoryTab.Profile,
    val items: List<MemoryItem> = emptyList(),
    val budget: MemoryBudget = MemoryBudget(),
    val loading: Boolean = true,
    val error: String? = null,
    /** Souvenir en cours de modification (bouton en attente). */
    val busy: String? = null,
    val notice: String? = null,
)

class MemoryViewModel(private val graph: AppGraph) : ViewModel() {
    private val _state = MutableStateFlow(MemoryUiState())
    val state: StateFlow<MemoryUiState> = _state

    init {
        load(MemoryTab.Profile)
    }

    fun load(tab: MemoryTab = _state.value.tab) {
        _state.update { it.copy(tab = tab, loading = it.tab != tab || it.items.isEmpty(), error = null) }
        viewModelScope.launch {
            runCatching { graph.api.memoryList(tab.key) }
                .onSuccess { list ->
                    if (_state.value.tab == tab) _state.update { it.copy(items = list.items, budget = list.profileBudget, loading = false) }
                }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message ?: "Instance injoignable") } }
        }
    }

    private fun act(uuid: String, ok: String, block: suspend () -> Unit) {
        _state.update { it.copy(busy = uuid) }
        viewModelScope.launch {
            runCatching { block() }
                .onSuccess { _state.update { it.copy(busy = null, notice = ok) }; load() }
                .onFailure { e -> _state.update { it.copy(busy = null, notice = e.message ?: "Action impossible") } }
        }
    }

    fun correct(uuid: String, content: String) = act(uuid, "Souvenir corrigé") {
        val r = graph.api.memoryCorrect(uuid, content)
        if (!r.ok) error(if (r.outcome == "rejected") "Refusé : ressemble à un secret." else "Correction refusée")
    }

    fun forget(uuid: String) = act(uuid, "Oublié") { graph.api.memoryForget(uuid) }

    fun pin(uuid: String, pinned: Boolean) = act(uuid, if (pinned) "Épinglé" else "Désépinglé") { graph.api.memoryPin(uuid, pinned) }

    fun noticeShown() = _state.update { it.copy(notice = null) }
}
