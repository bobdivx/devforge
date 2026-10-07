package app.jeser.devforge.ui.project

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.jeser.devforge.AppGraph
import app.jeser.devforge.data.ApiClient
import app.jeser.devforge.data.ApiException
import app.jeser.devforge.data.AgentMessage
import app.jeser.devforge.data.Deployment
import app.jeser.devforge.data.Project
import app.jeser.devforge.data.SpecFeature
import app.jeser.devforge.data.UnauthorizedException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.IOException

data class ChatItem(
    val key: String,
    val role: String,
    val content: String,
    val createdAt: String? = null,
    val hasPlan: Boolean = false,
)

data class LogsState(val deployment: Deployment, val text: String? = null, val loading: Boolean = true, val error: String? = null)
data class SpecState(val feature: SpecFeature, val markdown: String? = null, val loading: Boolean = true, val deciding: Boolean = false, val error: String? = null)

data class ProjectUiState(
    val uuid: String,
    val project: Project? = null,
    val deployments: List<Deployment> = emptyList(),
    val messages: List<ChatItem> = emptyList(),
    val coordinatorUuid: String? = null,
    val waitingSpecs: List<SpecFeature> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val sending: Boolean = false,
    val progress: String? = null,
    /** Incrémenté quand l'utilisateur envoie : force le défilement en bas une fois. */
    val sentCounter: Int = 0,
    val deploying: Boolean = false,
    val notice: String? = null,
    val logs: LogsState? = null,
    val spec: SpecState? = null,
    val creatingSpec: Boolean = false,
) {
    val latest: Deployment? get() = deployments.firstOrNull()
    val lastFailed: Boolean get() = latest?.isFailed == true
    val canDeploy: Boolean get() = !project?.gitRepository.isNullOrBlank() && latest?.isRunning != true && !deploying
}

object ChipText {
    const val HEALTH = "Est-ce que tout va bien ? Fais juste un bilan rapide (app en ligne, dernière mise en ligne, brouillon), sans rien modifier."
    const val DESIGN = "Améliore le design en local, puis montre-moi l’aperçu."
    const val REPAIR = "La dernière mise en ligne a échoué. Trouve la cause et propose une réparation, sans rien mettre en ligne."
    const val BUILD_PLAN = "Go — exécute ce plan en local, puis lance la preview."
}

fun AgentMessage.toChatItem(index: Int) = ChatItem(
    key = uuid ?: "m$index",
    role = role,
    content = content,
    createdAt = createdAt,
    hasPlan = role == "assistant" && hasPlan,
)

class ProjectViewModel(private val graph: AppGraph, val uuid: String) : ViewModel() {
    private val api: ApiClient get() = graph.api
    private val _state = MutableStateFlow(ProjectUiState(uuid))
    val state: StateFlow<ProjectUiState> = _state
    private var poll: Job? = null

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(loading = it.project == null, error = null) }
        viewModelScope.launch {
            try {
                val detail = api.project(uuid, live = true)
                _state.update { it.copy(project = detail.project, deployments = detail.deployments.ifEmpty { it.deployments }, loading = false) }
                launch { refreshDeployments() }
                launch { refreshSpecs() }
                val coord = api.agents(uuid).firstOrNull { it.role == "coordinator" }
                _state.update { it.copy(coordinatorUuid = coord?.uuid) }
                coord?.let { refreshMessages(it.uuid) }
            } catch (e: UnauthorizedException) {
                _state.update { it.copy(loading = false) }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, error = if (e.code == 404) "Cette app n'existe plus ou n'est pas dans ton espace." else e.message) }
            } catch (e: IOException) {
                _state.update { it.copy(loading = false, error = "Pas de connexion à l'instance.") }
            }
        }
    }

    private suspend fun refreshMessages(agent: String) {
        val list = api.messages(uuid, agent)
        val items = list.mapIndexed { i, m -> m.toChatItem(i) }
        _state.update { s ->
            // Ne remplace que si le contenu a changé : pas de recomposition inutile ni de saut.
            if (s.messages == items) s else s.copy(messages = items)
        }
    }

    private suspend fun refreshDeployments() {
        runCatching { api.deployments(uuid) }.onSuccess { list -> _state.update { it.copy(deployments = list) } }
    }

    private suspend fun refreshSpecs() {
        runCatching { api.specs(uuid) }.onSuccess { list ->
            _state.update { it.copy(waitingSpecs = list.filter { f -> f.awaitingValidation }) }
        }
    }

    /** Rafraîchit tant que l'écran est visible : vite pendant une mise en ligne, sinon toutes les 30 s. */
    fun startPolling() {
        if (poll?.isActive == true) return
        poll = viewModelScope.launch {
            var tick = 0
            while (isActive) {
                val s = _state.value
                delay(if (s.latest?.isRunning == true || s.sending) 4_000 else 30_000)
                tick++
                runCatching {
                    refreshDeployments()
                    s.coordinatorUuid?.let { refreshMessages(it) }
                    if (tick % 2 == 0) {
                        refreshSpecs()
                        val p = api.project(uuid, live = false).project
                        _state.update { it.copy(project = p) }
                    }
                }
            }
        }
    }

    fun stopPolling() {
        poll?.cancel()
    }

    fun send(text: String) {
        val msg = text.trim()
        val agent = _state.value.coordinatorUuid ?: return
        if (msg.isEmpty() || _state.value.sending) return
        _state.update {
            it.copy(
                sending = true,
                progress = "Braise lit ta demande…",
                sentCounter = it.sentCounter + 1,
                messages = it.messages + ChatItem("pending:${it.sentCounter}", "user", msg),
            )
        }
        viewModelScope.launch {
            try {
                api.chat(uuid, agent, msg) { label -> _state.update { it.copy(progress = label) } }
            } catch (e: UnauthorizedException) {
                // Déconnexion gérée globalement.
            } catch (e: ApiException) {
                _state.update { it.copy(notice = e.message) }
            } catch (e: IOException) {
                // Le serveur continue le tour : on suit le fil jusqu'à la réponse.
                waitForReply(agent)
            } finally {
                runCatching { refreshMessages(agent) }
                _state.update { it.copy(sending = false, progress = null) }
                launch { refreshSpecs() }
            }
        }
    }

    private suspend fun waitForReply(agent: String) {
        repeat(60) {
            delay(5_000)
            val agents = runCatching { api.agents(uuid) }.getOrNull() ?: return@repeat
            runCatching { refreshMessages(agent) }
            if (agents.firstOrNull { it.uuid == agent }?.status == "idle") return
        }
    }

    /** Seul point de publication : appelé depuis la feuille de confirmation. */
    fun deploy(message: String) {
        if (!_state.value.canDeploy) return
        _state.update { it.copy(deploying = true) }
        viewModelScope.launch {
            try {
                val dep = api.deploy(uuid, message.ifBlank { "Mise en ligne depuis l'app Android" })
                _state.update { it.copy(deployments = listOf(dep) + it.deployments.filter { d -> d.uuid != dep.uuid }, notice = "Mise en ligne lancée. Reconstruction depuis GitHub…") }
                refreshDeployments()
            } catch (e: ApiException) {
                _state.update { it.copy(notice = "Mise en ligne impossible : ${e.message}") }
            } catch (e: IOException) {
                _state.update { it.copy(notice = "Mise en ligne impossible : pas de connexion.") }
            } finally {
                _state.update { it.copy(deploying = false) }
            }
        }
    }

    fun openLogs(d: Deployment) {
        _state.update { it.copy(logs = LogsState(d)) }
        viewModelScope.launch {
            try {
                val text = api.deploymentLogs(d.uuid)
                _state.update { s -> if (s.logs?.deployment?.uuid == d.uuid) s.copy(logs = s.logs.copy(text = text, loading = false)) else s }
            } catch (e: IOException) {
                _state.update { s -> s.copy(logs = s.logs?.copy(loading = false, error = e.message ?: "Logs indisponibles")) }
            }
        }
    }

    fun closeLogs() = _state.update { it.copy(logs = null) }

    fun openSpec(f: SpecFeature) {
        _state.update { it.copy(spec = SpecState(f)) }
        viewModelScope.launch {
            try {
                val (feature, md) = api.spec(uuid, f.slug)
                _state.update { s -> s.copy(spec = s.spec?.copy(feature = feature, markdown = md, loading = false)) }
            } catch (e: IOException) {
                _state.update { s -> s.copy(spec = s.spec?.copy(loading = false, error = e.message)) }
            }
        }
    }

    fun closeSpec() = _state.update { it.copy(spec = null) }

    /** Approuver / Refuser : boutons explicites, jamais déduits du chat. */
    fun decideSpec(approve: Boolean) {
        val spec = _state.value.spec ?: return
        _state.update { it.copy(spec = spec.copy(deciding = true)) }
        viewModelScope.launch {
            try {
                api.decideSpec(uuid, spec.feature.slug, approve)
                _state.update {
                    it.copy(
                        spec = null,
                        notice = if (approve) "Spec approuvée. Braise construit en local, rien n'est publié." else "Spec refusée.",
                    )
                }
                refreshSpecs()
            } catch (e: IOException) {
                _state.update { s -> s.copy(spec = s.spec?.copy(deciding = false, error = e.message)) }
            }
        }
    }

    fun createSpec(title: String, description: String, onDone: () -> Unit) {
        if (title.isBlank()) return
        _state.update { it.copy(creatingSpec = true) }
        viewModelScope.launch {
            try {
                val f = api.createSpec(uuid, title.trim(), description.trim())
                onDone()
                _state.update { it.copy(creatingSpec = false, notice = "Spec écrite. Relis-la : rien n'est construit avant ton accord.") }
                refreshSpecs()
                openSpec(f)
            } catch (e: IOException) {
                _state.update { it.copy(creatingSpec = false, notice = e.message) }
            }
        }
    }

    fun noticeShown() = _state.update { it.copy(notice = null) }
}
