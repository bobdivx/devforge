package app.jeser.devforge.ui.hub

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.jeser.devforge.AppGraph
import app.jeser.devforge.data.AndroidInfo
import app.jeser.devforge.data.Conversation
import app.jeser.devforge.data.DraftSummary
import app.jeser.devforge.data.InboxEvent
import app.jeser.devforge.data.isNewerVersion
import app.jeser.devforge.notify.NotifKind
import app.jeser.devforge.notify.NotifSettings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.OffsetDateTime
import java.time.ZoneOffset

data class HubUiState(
    val conversations: List<Conversation> = emptyList(),
    val conversationsLoading: Boolean = true,
    val conversationsError: String? = null,
    /** Apps avec un brouillon (changements locaux pas encore sur GitHub). */
    val drafts: List<DraftSummary> = emptyList(),
    val alerts: List<InboxEvent> = emptyList(),
    val alertsLoading: Boolean = true,
    val alertsError: String? = null,
    val android: AndroidInfo? = null,
    val appVersion: String = "",
    val instance: String? = null,
    val notif: Map<String, Boolean> = NotifKind.entries.associate { it.key to true },
    val systemNotifOk: Boolean = true,
) {
    val waiting: List<Conversation> get() = conversations.filter { it.waiting != null }
    val updateAvailable: Boolean get() = android?.available == true && isNewerVersion(android.version, appVersion)
}

/** Onglets Braise, Alertes et Réglages (données légères, rafraîchies à l'ouverture de l'onglet). */
class HubViewModel(
    private val graph: AppGraph,
    private val settings: NotifSettings,
    appVersion: String,
    private val systemNotifOk: () -> Boolean,
) : ViewModel() {
    private val _state = MutableStateFlow(
        HubUiState(
            appVersion = appVersion,
            instance = graph.store.load()?.instanceUrl,
            notif = NotifKind.entries.associate { it.key to settings.enabled(it.key) },
            systemNotifOk = systemNotifOk(),
        ),
    )
    val state: StateFlow<HubUiState> = _state

    fun refreshConversations() {
        viewModelScope.launch {
            _state.update { it.copy(conversationsLoading = it.conversations.isEmpty(), conversationsError = null) }
            launch { runCatching { graph.api.drafts() }.onSuccess { d -> _state.update { it.copy(drafts = d) } } }
            runCatching { graph.api.conversations() }
                .onSuccess { list -> _state.update { it.copy(conversations = list, conversationsLoading = false) } }
                .onFailure { e -> _state.update { it.copy(conversationsLoading = false, conversationsError = e.message ?: "Instance injoignable") } }
        }
    }

    /** Historique : les 7 derniers jours (le serveur ne remonte pas plus loin). */
    fun refreshAlerts() {
        viewModelScope.launch {
            _state.update { it.copy(alertsLoading = it.alerts.isEmpty(), alertsError = null) }
            val since = OffsetDateTime.now(ZoneOffset.UTC).minusDays(7).toString()
            runCatching { graph.api.inbox(since = since, probe = false) }
                .onSuccess { inbox -> _state.update { it.copy(alerts = inbox.events, alertsLoading = false) } }
                .onFailure { e -> _state.update { it.copy(alertsLoading = false, alertsError = e.message ?: "Instance injoignable") } }
        }
    }

    fun refreshSettings() {
        _state.update { it.copy(systemNotifOk = systemNotifOk()) }
        viewModelScope.launch {
            runCatching { graph.api.androidInfo() }.onSuccess { info -> _state.update { it.copy(android = info) } }
        }
    }

    fun setNotif(kind: String, on: Boolean) {
        settings.set(kind, on)
        _state.update { it.copy(notif = it.notif + (kind to on)) }
    }

    fun apkUrl(): String? = runCatching { graph.api.apkUrl(_state.value.android?.downloadPath) }.getOrNull()
}
