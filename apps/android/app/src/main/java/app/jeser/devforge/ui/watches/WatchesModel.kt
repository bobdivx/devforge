package app.jeser.devforge.ui.watches

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.jeser.devforge.AppGraph
import app.jeser.devforge.data.PageWatch
import app.jeser.devforge.data.WatchCheck
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.Locale

enum class WatchTone { Ok, Danger, Warn, Accent, Neutral }

const val WATCH_MAX_FAILURES = 5

/** État de la tuile (mêmes mots que le web). */
fun watchStatus(w: PageWatch): Pair<String, WatchTone> = when {
    w.status == "paused" && w.pausedReason == "failures" -> "En pause · page injoignable" to WatchTone.Danger
    w.status == "paused" -> "En pause" to WatchTone.Neutral
    w.failureStreak > 0 -> "Erreur ${w.failureStreak}/$WATCH_MAX_FAILURES" to WatchTone.Warn
    w.lastCheckAt == null -> "Première lecture…" to WatchTone.Accent
    w.kind != "change" && w.conditionMet -> "Condition remplie" to WatchTone.Ok
    else -> "Surveillée" to WatchTone.Ok
}

fun formatAmount(v: Double, currency: String?): String {
    val cur = currency ?: "EUR"
    val n = if (v % 1.0 == 0.0) v.toLong().toString() else String.format(Locale.FRENCH, "%.2f", v)
    return when (cur) {
        "USD" -> "$$n"
        "GBP" -> "£$n"
        "CHF" -> "$n CHF"
        else -> "$n €"
    }
}

/** Ce qui est guetté, en une ligne. */
fun watchCondition(w: PageWatch): String = when (w.kind) {
    "text" -> "« ${w.needle.orEmpty()} » " + if (w.textMode == "disappears") "disparaît" else "apparaît"
    "price" -> "Prix ${if (w.priceOp == "above") "≥" else "≤"} ${formatAmount(w.threshold ?: 0.0, w.currency)}"
    else -> "Tout changement du texte"
}

fun watchSubtitle(w: PageWatch): String =
    if (w.kind == "price" && !w.lastValue.isNullOrBlank()) "${w.lastValue} · ${watchCondition(w)}" else watchCondition(w)

fun intervalLabel(minutes: Int): String = when {
    minutes < 60 -> "$minutes min"
    else -> "${minutes / 60} h"
}

fun watchHost(url: String): String =
    runCatching { java.net.URI(url).host?.removePrefix("www.") }.getOrNull()?.takeIf { it.isNotBlank() } ?: url

fun checkOutcome(outcome: String): Pair<String, WatchTone> = when (outcome) {
    "baseline" -> "Référence" to WatchTone.Neutral
    "unchanged" -> "Sans changement" to WatchTone.Neutral
    "changed" -> "Changement" to WatchTone.Accent
    "met" -> "Condition remplie" to WatchTone.Ok
    "not_met" -> "Pas encore" to WatchTone.Neutral
    "error" -> "Erreur" to WatchTone.Danger
    else -> outcome to WatchTone.Neutral
}

/** Heure lisible en Europe/Paris (ex. « 25 oct. 14:05 »). */
fun watchWhen(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    return runCatching {
        val t = java.time.OffsetDateTime.parse(iso).atZoneSameInstant(java.time.ZoneId.of("Europe/Paris"))
        java.time.format.DateTimeFormatter.ofPattern("d MMM HH:mm", Locale.FRENCH).format(t)
    }.getOrNull()
}

/** Lignes du détail, sans champ vide. */
fun watchDetails(w: PageWatch): List<Pair<String, String>> = listOf(
    "Guette" to watchCondition(w),
    "Dernière valeur" to (if (w.kind == "change") null else w.lastValue),
    "Fréquence" to "Toutes les ${intervalLabel(w.intervalMinutes)}",
    "Dernière lecture" to (watchWhen(w.lastCheckAt) ?: "Pas encore"),
    "Prochaine" to (if (w.status == "active") watchWhen(w.nextCheckAt) else null),
    "Dernière alerte" to watchWhen(w.lastAlertAt),
).mapNotNull { (k, v) -> v?.takeIf { it.isNotBlank() }?.let { k to it } }

data class WatchesUiState(
    val items: List<PageWatch> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val open: PageWatch? = null,
    val checks: List<WatchCheck> = emptyList(),
    val busy: String? = null,
    val actionError: String? = null,
    val confirmDelete: Boolean = false,
)

class WatchesViewModel(private val graph: AppGraph) : ViewModel() {
    private val _state = MutableStateFlow(WatchesUiState())
    val state: StateFlow<WatchesUiState> = _state

    fun load() {
        _state.update { it.copy(loading = it.items.isEmpty(), error = null) }
        viewModelScope.launch {
            runCatching { graph.api.watches() }
                .onSuccess { list -> _state.update { it.copy(items = list.data, loading = false) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message ?: "Instance injoignable") } }
            // Ouvrir l'écran vaut lecture des alertes (la cloche du web se vide aussi).
            runCatching { graph.api.markWatchAlertsRead() }
        }
    }

    fun open(w: PageWatch) {
        _state.update { it.copy(open = w, checks = emptyList(), actionError = null, confirmDelete = false) }
        refreshOpen(w.uuid)
    }

    fun close() = _state.update { it.copy(open = null, checks = emptyList(), confirmDelete = false, actionError = null) }

    private fun refreshOpen(uuid: String) {
        viewModelScope.launch {
            runCatching { graph.api.watch(uuid) }.onSuccess { d -> apply(d.data, d.checks) }
        }
    }

    private fun apply(w: PageWatch, checks: List<WatchCheck>? = null) {
        _state.update { s ->
            s.copy(
                items = s.items.map { if (it.uuid == w.uuid) w else it },
                open = if (s.open?.uuid == w.uuid) w else s.open,
                checks = checks ?: s.checks,
            )
        }
    }

    private fun act(kind: String, block: suspend (String) -> Unit) {
        val w = _state.value.open ?: return
        if (_state.value.busy != null) return
        _state.update { it.copy(busy = kind, actionError = null) }
        viewModelScope.launch {
            runCatching { block(w.uuid) }
                .onSuccess {
                    runCatching { graph.api.watch(w.uuid) }.onSuccess { d -> apply(d.data, d.checks) }
                    _state.update { it.copy(busy = null) }
                }
                .onFailure { e -> _state.update { it.copy(busy = null, actionError = e.message ?: "Action impossible") } }
        }
    }

    fun runNow() = act("run") { graph.api.runWatch(it) }
    fun pause() = act("pause") { graph.api.pauseWatch(it) }
    fun resume() = act("resume") { graph.api.resumeWatch(it) }

    fun askDelete() = _state.update { it.copy(confirmDelete = true) }
    fun cancelDelete() = _state.update { it.copy(confirmDelete = false) }

    fun delete() {
        val w = _state.value.open ?: return
        _state.update { it.copy(busy = "delete", actionError = null) }
        viewModelScope.launch {
            runCatching { graph.api.deleteWatch(w.uuid) }
                .onSuccess {
                    _state.update { s -> s.copy(items = s.items.filterNot { it.uuid == w.uuid }, open = null, busy = null, confirmDelete = false) }
                }
                .onFailure { e -> _state.update { it.copy(busy = null, confirmDelete = false, actionError = e.message ?: "Suppression impossible") } }
        }
    }
}
