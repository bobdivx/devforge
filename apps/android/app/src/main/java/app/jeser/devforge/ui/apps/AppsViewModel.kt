package app.jeser.devforge.ui.apps

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.jeser.devforge.AppGraph
import app.jeser.devforge.data.ApiException
import app.jeser.devforge.data.InboxEvent
import app.jeser.devforge.data.Me
import app.jeser.devforge.data.Project
import app.jeser.devforge.data.UnauthorizedException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.IOException

data class AppsUiState(
    val projects: List<Project> = emptyList(),
    val inbox: List<InboxEvent> = emptyList(),
    val me: Me? = null,
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val error: String? = null,
)

class AppsViewModel(private val graph: AppGraph) : ViewModel() {
    private val _state = MutableStateFlow(AppsUiState())
    val state: StateFlow<AppsUiState> = _state
    private var poll: Job? = null

    init {
        viewModelScope.launch { graph.inbox.collect { ev -> _state.update { it.copy(inbox = ev) } } }
        refresh(initial = true)
        viewModelScope.launch { runCatching { graph.api.me() }.onSuccess { me -> _state.update { it.copy(me = me) } } }
    }

    fun refresh(initial: Boolean = false) {
        _state.update { it.copy(refreshing = !initial, loading = initial && it.projects.isEmpty()) }
        viewModelScope.launch {
            try {
                val list = graph.api.projects()
                _state.update { it.copy(projects = list, loading = false, refreshing = false, error = null) }
            } catch (e: UnauthorizedException) {
                _state.update { it.copy(loading = false, refreshing = false) }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, refreshing = false, error = e.message) }
            } catch (e: IOException) {
                _state.update { it.copy(loading = false, refreshing = false, error = "Pas de connexion à l'instance.") }
            }
            // Premier plan : la boîte de réception est rafraîchie sans notifier (elle est à l'écran).
            runCatching { graph.syncInbox(notify = false, probe = !initial) }
        }
    }

    /** Rafraîchissement doux tant que l'écran est visible. */
    fun startPolling() {
        if (poll?.isActive == true) return
        poll = viewModelScope.launch {
            while (isActive) {
                delay(60_000)
                runCatching { graph.api.projects() }.onSuccess { list -> _state.update { it.copy(projects = list, error = null) } }
                runCatching { graph.syncInbox(notify = false, probe = false) }
            }
        }
    }

    fun stopPolling() {
        poll?.cancel()
    }
}
