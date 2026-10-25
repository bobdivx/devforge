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
import app.jeser.devforge.data.DeployCard
import app.jeser.devforge.data.Deployment
import app.jeser.devforge.data.DraftDiffFile
import app.jeser.devforge.data.DraftStatus
import app.jeser.devforge.data.DraftValidated
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
import app.jeser.devforge.notify.DeployWatchWorker
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
    /** Cartes de job (workers délégués, mises en ligne) attachées au message. */
    val jobs: List<app.jeser.devforge.data.JobInfo> = emptyList(),
    /** P5 : uuid serveur, question `ask_user`, réponse structurée, images, réactions. */
    val uuid: String? = null,
    val question: app.jeser.devforge.data.QuestionInfo? = null,
    val answer: app.jeser.devforge.data.AnswerInfo? = null,
    val attachments: List<app.jeser.devforge.data.AttachmentInfo> = emptyList(),
    val reactions: List<app.jeser.devforge.data.ReactionInfo> = emptyList(),
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
    /** Brouillon : changements locaux pas encore sur GitHub. */
    val draft: DraftStatus? = null,
    val corrections: app.jeser.devforge.data.CorrectionsState? = null,
    val correctionConflict: String? = null,
    val draftDiff: List<DraftDiffFile>? = null,
    val draftDiffError: String? = null,
    /** Action brouillon en cours : validate, discard, revert, update, restore. */
    val draftBusy: String? = null,
    val draftError: String? = null,
    val draftValidated: DraftValidated? = null,
    /** Message + sauvegarde à proposer en « Annuler » (snackbar). */
    val undo: DraftUndo? = null,
    /** P5-02 : images du composer (envoyées dès l'ajout). */
    val pendingImages: List<app.jeser.devforge.data.PendingImage> = emptyList(),
) {
    /** Dernière mise en ligne de la prod (la dev a sa propre section Branches). */
    val latest: Deployment? get() = deployments.firstOrNull { !it.isDev } ?: deployments.firstOrNull()
    val lastFailed: Boolean get() = latest?.isFailed == true
    /** Action de mise en ligne adaptée à l'état réel (publier, réessayer, reconstruire). */
    val deployPlan: DeployPlan get() = deployPlan(!project?.gitRepository.isNullOrBlank(), latest, git, deploying)
    val canDeploy: Boolean get() = !project?.gitRepository.isNullOrBlank() && latest?.isRunning != true && !deploying
    val containerState: ContainerState get() = parseContainerStatus(container)
    val summary: LiveSummary get() = liveSummary(project, containerState, latest)
    val team: List<PersonaStatus> get() = teamStatus(agents, specs, latest)
    val canControl: Boolean get() = containerState.exists && lifecycleBusy == null && latest?.isRunning != true
}

data class DraftUndo(val message: String, val backupId: String)

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
    jobs = if (role == "assistant") app.jeser.devforge.data.jobsFromToolCalls(toolCalls) else emptyList(),
    uuid = uuid,
    question = if (role == "assistant") app.jeser.devforge.data.questionFromToolCalls(toolCalls) else null,
    answer = if (role == "user") app.jeser.devforge.data.answerFromToolCalls(toolCalls) else null,
    attachments = attachments,
    reactions = reactions,
)

class ProjectViewModel(private val graph: AppGraph, val uuid: String) : ViewModel() {
    private val api: ApiClient get() = graph.api
    private val _state = MutableStateFlow(ProjectUiState(uuid))
    /** Runs pausés / repris / relancés depuis l'app : suivis même si une carte de résultat existe. */
    private val controlledRuns = java.util.concurrent.CopyOnWriteArraySet<String>()

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
                launch { refreshDraft(fetch = true) }
                launch { refreshCorrections() }
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
        val raw = list.mapIndexed { i, m -> m.toChatItem(i) }
        val merged = app.jeser.devforge.data.mergeJobStatus(raw.map { it.jobs })
        // Workers encore en cours : on lit leur run (jalons, statut) — 3 au plus par rafraîchissement.
        val liveIds = (merged.flatten().filter { (it.live || it.paused) && it.kind == "worker" }.map { it.id }.distinct().takeLast(3) +
            controlledRuns).distinct()
        val live = liveIds.mapNotNull { id -> runCatching { api.agentRun(id) }.getOrNull()?.let { id to it } }.toMap()
        val jobs = if (live.isEmpty()) merged else app.jeser.devforge.data.mergeJobStatus(merged, live)
        val deploys = _state.value.deployments.associateBy { it.uuid }
        val items = raw.mapIndexed { i, m ->
            if (m.jobs.isEmpty()) m
            else m.copy(jobs = jobs[i].map { j ->
                val d = if (j.kind == "deploy") deploys[j.id] else null
                if (d == null) j else j.copy(status = app.jeser.devforge.data.jobStatus(d.status), summary = d.errorSummary ?: j.summary)
            })
        }
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
                if (tick % 2 == 0) { refreshDraft(); refreshCorrections() }
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
                val jobLive = s.messages.any { m -> m.jobs.any { it.live } }
                delay(if (s.latest?.isRunning == true || s.sending) 4_000 else if (jobLive) 6_000 else 30_000)
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

    /** Bail SQL : pause, reprise ou relance d'un worker. */
    fun controlJob(runUuid: String, action: String) {
        viewModelScope.launch {
            runCatching { api.controlRun(runUuid, action) }
                .onSuccess {
                    controlledRuns.add(runUuid)
                    _state.value.coordinatorUuid?.let { a -> runCatching { refreshMessages(a) } }
                }
                .onFailure { e -> _state.update { it.copy(notice = e.message ?: "Action impossible") } }
        }
    }

    /** Arrête un worker délégué (annulation réelle côté serveur). */
    fun cancelJob(runUuid: String) {
        viewModelScope.launch {
            runCatching { api.cancelRun(runUuid) }
                .onSuccess { _state.value.coordinatorUuid?.let { a -> runCatching { refreshMessages(a) } } }
                .onFailure { e -> _state.update { it.copy(notice = e.message ?: "Arrêt impossible") } }
        }
    }

    /** P5-04 : réponse à une question (accord de publication d'abord si l'option le demande). */
    fun answer(item: ChatItem, option: app.jeser.devforge.data.QuestionOption?, freeText: String? = null) {
        val q = item.question ?: return
        if (_state.value.sending) return
        val label = option?.label ?: "Autre"
        viewModelScope.launch {
            if (option?.action == "approve_publish") {
                val ok = runCatching { api.approvePublish(uuid) }.onFailure { e -> _state.update { it.copy(notice = e.message ?: "Validation impossible") } }.isSuccess
                if (!ok) return@launch
            }
            val payload = kotlinx.serialization.json.buildJsonObject {
                item.uuid?.let { put("message_uuid", kotlinx.serialization.json.JsonPrimitive(it)) }
                option?.let { put("option_id", kotlinx.serialization.json.JsonPrimitive(it.id)) }
                put("label", kotlinx.serialization.json.JsonPrimitive(label))
                put("question", kotlinx.serialization.json.JsonPrimitive(q.question))
                if (!freeText.isNullOrBlank()) put("text", kotlinx.serialization.json.JsonPrimitive(freeText.trim()))
            }
            val answerInfo = app.jeser.devforge.data.AnswerInfo(item.uuid, option?.id, label, freeText?.trim())
            send(app.jeser.devforge.data.answerModelText(q.question, label, freeText), answer = payload, answerInfo = answerInfo)
        }
    }

    /** P5-03 : réaction optimiste, corrigée par la réponse du serveur. */
    fun react(item: ChatItem, emoji: String) {
        val id = item.uuid ?: return
        val before = _state.value.messages.firstOrNull { it.key == item.key }?.reactions ?: return
        val mine = before.any { it.emoji == emoji && it.mine }
        fun put(list: List<app.jeser.devforge.data.ReactionInfo>) =
            _state.update { s -> s.copy(messages = s.messages.map { if (it.key == item.key) it.copy(reactions = list) else it }) }
        put(app.jeser.devforge.data.toggleReaction(before, emoji))
        viewModelScope.launch {
            runCatching { api.react(id, emoji, !mine) }
                .onSuccess { put(it.reactions) }
                .onFailure { e ->
                    put(before)
                    _state.update { it.copy(notice = e.message ?: "Réaction non enregistrée") }
                }
        }
    }

    /** P5-02 : image choisie → envoyée tout de suite ; la vignette suit l'état. */
    fun attachImage(bytes: ByteArray, mime: String, name: String) {
        val agent = _state.value.coordinatorUuid ?: return
        if (_state.value.pendingImages.size >= 4) {
            _state.update { it.copy(notice = "4 images maximum par message.") }
            return
        }
        if (mime !in app.jeser.devforge.data.ACCEPTED_IMAGE_MIMES || bytes.size > app.jeser.devforge.data.MAX_IMAGE_BYTES) {
            _state.update { it.copy(notice = if (bytes.size > app.jeser.devforge.data.MAX_IMAGE_BYTES) "Image trop lourde (10 Mo max)." else "PNG, JPEG, WebP ou GIF uniquement.") }
            return
        }
        val localId = "img:${System.nanoTime()}"
        val pending = app.jeser.devforge.data.PendingImage(localId, name, preview = bytes)
        _state.update { it.copy(pendingImages = it.pendingImages + pending) }
        fun set(fn: (app.jeser.devforge.data.PendingImage) -> app.jeser.devforge.data.PendingImage) =
            _state.update { s -> s.copy(pendingImages = s.pendingImages.map { if (it.localId == localId) fn(it) else it }) }
        viewModelScope.launch {
            runCatching { api.uploadAttachment(uuid, agent, bytes, mime, name) }
                .onSuccess { info -> set { it.copy(status = "ready", info = info) } }
                .onFailure { e ->
                    set { it.copy(status = "error", error = e.message) }
                    _state.update { it.copy(notice = e.message ?: "Image non jointe") }
                }
        }
    }

    fun removeImage(localId: String) {
        _state.update { s -> s.copy(pendingImages = s.pendingImages.filterNot { it.localId == localId }) }
    }

    fun send(text: String, answer: kotlinx.serialization.json.JsonObject? = null, answerInfo: app.jeser.devforge.data.AnswerInfo? = null) {
        val msg = text.trim()
        val agent = _state.value.coordinatorUuid ?: return
        val images = if (answer == null) _state.value.pendingImages.filter { it.status == "ready" }.mapNotNull { it.info } else emptyList()
        if ((msg.isEmpty() && images.isEmpty()) || _state.value.sending) return
        if (_state.value.pendingImages.any { it.status == "uploading" } && answer == null) {
            _state.update { it.copy(notice = "Image en cours d’envoi, réessaie dans un instant.") }
            return
        }
        _state.update {
            it.copy(
                sending = true,
                progress = "Braise lit ta demande…",
                sentCounter = it.sentCounter + 1,
                messages = it.messages + ChatItem("pending:${it.sentCounter}", "user", msg, answer = answerInfo, attachments = images),
                pendingImages = if (answer == null) emptyList() else it.pendingImages,
            )
        }
        viewModelScope.launch {
            try {
                api.chat(uuid, agent, if (answer != null) "" else msg, answer = answer, attachments = images.map { it.id }) { label -> _state.update { it.copy(progress = label) } }
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
                _state.update {
                    it.copy(
                        deployments = listOf(dep) + it.deployments.filter { d -> d.uuid != dep.uuid },
                        // Statut local : la tuile anime tout de suite ; onChanged rafraîchit la grille Apps.
                        project = it.project?.copy(
                            status = "deploying",
                            deploy = DeployCard(
                                status = dep.status.ifBlank { "queued" },
                                sha = dep.gitSha,
                                message = dep.gitMessage,
                            ),
                        ),
                        notice = "Mise en ligne lancée. Reconstruction depuis GitHub…",
                    )
                }
                refreshDeployments()
                // Notif barre système : démarrer le suivi tout de suite.
                DeployWatchWorker.kick(graph.appContext, force = true)
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

    /* ---------------- Brouillon ---------------- */

    private suspend fun refreshDraft(fetch: Boolean = false) {
        runCatching { api.draft(uuid, fetch) }.onSuccess { d -> _state.update { s -> if (s.draft == d) s else s.copy(draft = d) } }
    }

    private fun draftErrorText(e: Throwable): String = when (e) {
        is UnauthorizedException -> "Session expirée."
        is ApiException -> e.message ?: "Le serveur a refusé."
        else -> "Pas de connexion à l'instance."
    }

    /** Ouvre la feuille : charge le diff de tous les fichiers. */
    fun openDraft() {
        _state.update { it.copy(draftDiff = null, draftDiffError = null, draftError = null, draftValidated = null) }
        viewModelScope.launch {
            refreshDraft()
            runCatching { api.draftDiff(uuid) }
                .onSuccess { files -> _state.update { it.copy(draftDiff = files) } }
                .onFailure { e -> _state.update { it.copy(draftDiffError = draftErrorText(e)) } }
        }
    }

    private fun draftAction(key: String, block: suspend () -> Unit) {
        if (_state.value.draftBusy != null) return
        _state.update { it.copy(draftBusy = key, draftError = null) }
        viewModelScope.launch {
            try {
                block()
            } catch (e: IOException) {
                _state.update { it.copy(draftError = draftErrorText(e)) }
            } finally {
                _state.update { it.copy(draftBusy = null) }
            }
        }
    }

    /** « Valider » : commit + push sur GitHub. Seulement depuis la feuille de confirmation. */
    fun validateDraft(message: String) = draftAction("validate") {
        val v = api.draftValidate(uuid, message)
        _state.update { it.copy(draftValidated = v) }
        refreshDraft()
        runCatching { api.git(uuid) }.onSuccess { g -> _state.update { it.copy(git = g) } }
    }

    /** « Supprimer le brouillon » : sauvegarde 7 jours puis retour à l'état de GitHub. */
    fun discardDraft(onDone: () -> Unit) = draftAction("discard") {
        val r = api.draftDiscard(uuid)
        refreshDraft()
        onDone()
        val n = r.files
        _state.update {
            it.copy(
                undo = DraftUndo("Brouillon supprimé ($n fichier${if (n > 1) "s" else ""}). Sauvegarde gardée 7 jours.", r.backupId),
                preview = it.preview?.copy(status = "stopped"),
            )
        }
    }

    fun revertDraftFile(path: String, onDone: () -> Unit) = draftAction("revert") {
        val r = api.draftRevertFile(uuid, path)
        refreshDraft()
        _state.update { s -> s.copy(draftDiff = s.draftDiff?.filter { it.path != path }, undo = DraftUndo("Fichier remis comme sur GitHub.", r.backupId)) }
        onDone()
    }

    fun restoreDraft(backupId: String) = draftAction("restore") {
        val r = api.draftRestore(uuid, backupId)
        refreshDraft()
        _state.update { it.copy(notice = "Brouillon restauré (${r.files} fichier${if (r.files > 1) "s" else ""}).") }
    }

    fun updateDraftFromGithub() = draftAction("update") {
        val r = api.draftUpdateFromGithub(uuid)
        refreshDraft()
        _state.update { it.copy(notice = if (r.merged > 0) "Brouillon à jour : ${r.merged} commit${if (r.merged > 1) "s" else ""} récupéré${if (r.merged > 1) "s" else ""}." else "Le brouillon est déjà à jour.") }
    }

    fun undoShown() = _state.update { it.copy(undo = null) }
    private suspend fun refreshCorrections() {
        runCatching { api.corrections(uuid) }.onSuccess { c -> _state.update { s -> if (s.corrections == c) s else s.copy(corrections = c) } }
    }

    fun openCorrections() {
        _state.update { it.copy(correctionConflict = null) }
        openDraft()
        viewModelScope.launch { refreshCorrections() }
    }

    fun applyCorrection(onDone: () -> Unit) = draftAction("apply") {
        val r = api.correctionApply(uuid)
        if (r.conflict) {
            _state.update { it.copy(correctionConflict = r.message ?: "Le code a changé au même endroit.") }
        } else {
            _state.update { it.copy(notice = if (r.deployed) "Correction appliquée · mise en ligne en cours" else "Correction envoyée · pas de nouvelle tentative automatique") }
            onDone()
        }
        refreshDraft(); refreshCorrections()
    }

    fun rejectCorrection(onDone: () -> Unit) = draftAction("reject") {
        api.correctionReject(uuid)
        _state.update { it.copy(notice = "Correction rejetée · récupérable 7 jours") }
        refreshDraft(); refreshCorrections()
        onDone()
    }

    fun redoCorrection(onDone: () -> Unit) = draftAction("redo") {
        api.correctionRedo(uuid)
        _state.update { it.copy(correctionConflict = null, notice = "Rustine refait la correction") }
        refreshDraft(); refreshCorrections()
        onDone()
    }

    fun restoreCorrection(backupId: String) = draftAction("restore") {
        api.draftRestore(uuid, backupId)
        refreshDraft(); refreshCorrections()
    }

    fun draftValidatedSeen() = _state.update { it.copy(draftValidated = null) }
}
