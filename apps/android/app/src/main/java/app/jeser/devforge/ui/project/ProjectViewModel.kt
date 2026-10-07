package app.jeser.devforge.ui.project

import app.jeser.devforge.data.DeployPlan
import app.jeser.devforge.data.deployPlan

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.jeser.devforge.AppGraph
import app.jeser.devforge.data.ApiClient
import app.jeser.devforge.data.ApiException
import app.jeser.devforge.data.Agent
import app.jeser.devforge.data.AgentMessage
import app.jeser.devforge.data.ContainerState
import app.jeser.devforge.data.ContainerStatus
import app.jeser.devforge.data.Deployment
import app.jeser.devforge.data.GitInfo
import app.jeser.devforge.data.LiveSummary
import app.jeser.devforge.data.PersonaStatus
import app.jeser.devforge.data.PreviewStatus
import app.jeser.devforge.data.Project
import app.jeser.devforge.data.SpecFeature
import app.jeser.devforge.data.UnauthorizedException
import app.jeser.devforge.data.liveSummary
import app.jeser.devforge.data.parseContainerStatus
import app.jeser.devforge.data.teamStatus
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

/** Logs d'exécution de l'app (conteneur), lecture seule. */
data class RuntimeLogsState(val text: String? = null, val loading: Boolean = true, val error: String? = null)

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
    /** État Docker (rafraîchi toutes les 10 s quand l'écran est ouvert). */
    val container: ContainerStatus? = null,
    val checkedAt: String? = null,
    val git: GitInfo? = null,
    val agents: List<Agent> = emptyList(),
    val specs: List<SpecFeature> = emptyList(),
    val preview: PreviewStatus? = null,
    val previewStarting: Boolean = false,
    /** Action start / stop / restart en cours. */
    val lifecycleBusy: String? = null,
    val runtimeLogs: RuntimeLogsState? = null,
    /** Lien à ouvrir une fois (aperçu prêt). */
    val openUrl: String? = null,
) {
    val latest: Deployment? get() = deployments.firstOrNull()
    val lastFailed: Boolean get() = latest?.isFailed == true
    /** Action de mise en ligne adaptée à l'état réel (publier, réessayer, reconstruire). */
    val deployPlan: DeployPlan get() = deployPlan(!project?.gitRepository.isNullOrBlank(), latest, git, deploying)
    val canDeploy: Boolean get() = !project?.gitRepository.isNullOrBlank() && latest?.isRunning != true && !deploying
    val containerState: ContainerState get() = parseContainerStatus(container)
    val summary: LiveSummary get() = liveSummary(project, containerState, latest)
    val team: List<PersonaStatus> get() = teamStatus(agents, specs, latest)
    val canControl: Boolean get() = containerState.exists && lifecycleBusy == null && latest?.isRunning != true
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
                launch { refreshContainer() }
                launch { runCatching { api.git(uuid) }.onSuccess { g -> _state.update { it.copy(git = g) } } }
                launch { runCatching { api.preview(uuid) }.onSuccess { pv -> _state.update { it.copy(preview = pv) } } }
                val agents = api.agents(uuid)
                val coord = agents.firstOrNull { it.role == "coordinator" }
                _state.update { it.copy(coordinatorUuid = coord?.uuid, agents = agents) }
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
            _state.update { it.copy(specs = list, waitingSpecs = list.filter { f -> f.awaitingValidation }) }
        }
    }

    private suspend fun refreshContainer() {
        runCatching { api.containerStatus(uuid) }.onSuccess { c ->
            val now = java.time.OffsetDateTime.now().toString()
            _state.update { s -> if (s.container == c) s.copy(checkedAt = now) else s.copy(container = c, checkedAt = now) }
        }
    }

    private var statusPoll: Job? = null
    /** Rafraîchissement rapide après une action (toutes les 2 s pendant ~30 s). */
    private var fastUntil = 0L

    /** États réels pendant que l'écran est ouvert : conteneur 10 s, sonde HTTP 30 s, GitHub 60 s. */
    private fun startStatusPolling() {
        if (statusPoll?.isActive == true) return
        statusPoll = viewModelScope.launch {
            var tick = 0
            while (isActive) {
                delay(if (System.currentTimeMillis() < fastUntil) 2_000 else 10_000)
                tick++
                refreshContainer()
                if (tick % 3 == 0 || System.currentTimeMillis() < fastUntil) {
                    runCatching { api.project(uuid, live = true).project }.onSuccess { p ->
                        _state.update { s -> if (s.project == p) s else s.copy(project = p) }
                    }
                }
                if (tick % 6 == 0) {
                    runCatching { api.git(uuid) }.onSuccess { g -> _state.update { s -> if (s.git == g) s else s.copy(git = g) } }
                    runCatching { api.agents(uuid) }.onSuccess { a -> _state.update { s -> if (s.agents == a) s else s.copy(agents = a) } }
                }
            }
        }
    }

    /** Rafraîchit tant que l'écran est visible : vite pendant une mise en ligne, sinon toutes les 30 s. */
    fun startPolling() {
        startStatusPolling()
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
        statusPoll?.cancel()
    }

    /**
     * Démarrer / Arrêter / Redémarrer. Arrêter et Redémarrer n'arrivent ici
     * qu'après la feuille de confirmation.
     */
    fun lifecycle(action: String) {
        if (_state.value.lifecycleBusy != null) return
        val name = _state.value.project?.name ?: "L'app"
        _state.update { it.copy(lifecycleBusy = action) }
        viewModelScope.launch {
            val msg = try {
                val r = api.lifecycle(uuid, action)
                if (r.ok) when (action) {
                    "stop" -> "$name est arrêtée."
                    "start" -> "$name démarre."
                    else -> "$name redémarre."
                } else "Action impossible : ${r.error ?: "le serveur a refusé"}"
            } catch (e: UnauthorizedException) {
                null
            } catch (e: ApiException) {
                "Action impossible : ${e.message}"
            } catch (e: IOException) {
                "Action envoyée, vérification en cours…"
            }
            fastUntil = System.currentTimeMillis() + 30_000
            refreshContainer()
            runCatching { api.project(uuid, live = true).project }.onSuccess { p -> _state.update { it.copy(project = p) } }
            _state.update { it.copy(lifecycleBusy = null, notice = msg ?: it.notice) }
        }
    }

    fun openRuntimeLogs() {
        _state.update { it.copy(runtimeLogs = RuntimeLogsState()) }
        refreshRuntimeLogs()
        // Les logs de la dernière mise en ligne sont dans le même panneau.
        _state.value.latest?.let { d -> if (_state.value.logs == null) loadDeployLogs(d, open = false) }
    }

    fun refreshRuntimeLogs() {
        _state.update { s -> s.copy(runtimeLogs = (s.runtimeLogs ?: RuntimeLogsState()).copy(loading = true, error = null)) }
        viewModelScope.launch {
            try {
                val r = api.runtimeLogs(uuid, 300)
                _state.update { s ->
                    s.copy(runtimeLogs = s.runtimeLogs?.copy(text = r.logs, loading = false, error = if (r.ok) null else r.error))
                }
            } catch (e: ApiException) {
                val msg = if (e.code == 404) "Logs de l'app pas encore disponibles sur ce serveur." else e.message
                _state.update { s -> s.copy(runtimeLogs = s.runtimeLogs?.copy(loading = false, error = msg)) }
            } catch (e: IOException) {
                _state.update { s -> s.copy(runtimeLogs = s.runtimeLogs?.copy(loading = false, error = "Pas de connexion à l'instance.")) }
            }
        }
    }

    fun closeRuntimeLogs() = _state.update { it.copy(runtimeLogs = null, logs = null) }

    /** Aperçu brouillon : local, jamais publié. Démarre si besoin puis ouvre le lien. */
    fun openPreview() {
        val pv = _state.value.preview
        if (pv?.running == true && !pv.previewUrl.isNullOrBlank()) {
            _state.update { it.copy(openUrl = pv.previewUrl) }
            return
        }
        if (_state.value.previewStarting) return
        _state.update { it.copy(previewStarting = true, notice = "Braise prépare l'aperçu du brouillon…") }
        viewModelScope.launch {
            try {
                var cur = api.startPreview(uuid)
                repeat(30) {
                    if (cur.running && !cur.previewUrl.isNullOrBlank()) return@repeat
                    delay(3_000)
                    cur = runCatching { api.preview(uuid) }.getOrDefault(cur)
                }
                _state.update {
                    it.copy(
                        preview = cur,
                        openUrl = cur.previewUrl?.takeIf { _ -> cur.running },
                        notice = if (cur.running) null else "L'aperçu met du temps à démarrer. Réessaie dans un instant.",
                    )
                }
            } catch (e: IOException) {
                _state.update { it.copy(notice = "Aperçu impossible : ${e.message ?: "pas de connexion"}") }
            } finally {
                _state.update { it.copy(previewStarting = false) }
            }
        }
    }

    fun urlOpened() = _state.update { it.copy(openUrl = null) }

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

    fun openLogs(d: Deployment) = loadDeployLogs(d, open = true)

    private fun loadDeployLogs(d: Deployment, @Suppress("UNUSED_PARAMETER") open: Boolean) {
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
