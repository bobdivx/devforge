package app.jeser.devforge.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

/** Parsing tolérant : l'API ajoute des champs au fil des versions. */
val DevForgeJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
    isLenient = true
}

@Serializable
data class DataEnvelope<T>(val data: T)

@Serializable
data class DeployCard(
    val status: String? = null,
    val sha: String? = null,
    val message: String? = null,
)

@Serializable
data class SyncInfo(
    val state: String? = null,
    @SerialName("behind_by") val behindBy: Int? = null,
)

@Serializable
data class Project(
    val uuid: String,
    val name: String,
    val slug: String = "",
    val status: String = "draft",
    @SerialName("production_url") val productionUrl: String? = null,
    @SerialName("git_repository") val gitRepository: String? = null,
    @SerialName("git_branch") val gitBranch: String? = null,
    /** Branche de l'environnement dev (null = désactivé). */
    @SerialName("dev_branch") val devBranch: String? = null,
    @SerialName("dev_url") val devUrl: String? = null,
    @SerialName("build_pack") val buildPack: String? = null,
    @SerialName("group_name") val groupName: String? = null,
    val role: String? = null,
    /** Booléen dans la liste, entier dans le détail : lu via [autoDeployEnabled]. */
    @SerialName("auto_deploy") val autoDeploy: JsonElement? = null,
    val deploy: DeployCard? = null,
    val sync: SyncInfo? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
) {
    val autoDeployEnabled: Boolean
        get() = (autoDeploy as? JsonPrimitive)?.let { it.booleanOrNull ?: (it.intOrNull?.let { n -> n != 0 }) } ?: false

    val appStatus: AppStatus get() = AppStatus.from(status)
}

/** Statut affiché : trois états simples + brouillon. */
enum class AppStatus(val label: String) {
    Live("En ligne"),
    Deploying("Déploiement"),
    Failed("Échec"),
    Down("Ne répond plus"),
    Draft("Brouillon"),
    Stopped("Arrêtée");

    companion object {
        fun from(raw: String?): AppStatus = when (raw?.lowercase()) {
            "live", "running", "ready", "success" -> Live
            "deploying", "building", "queued", "pending" -> Deploying
            "failed", "error" -> Failed
            "unhealthy", "unrouted" -> Down
            "stopped", "exited" -> Stopped
            else -> Draft
        }
    }
}

@Serializable
data class ProjectDetail(
    val project: Project,
    val deployments: List<Deployment> = emptyList(),
)

@Serializable
data class Deployment(
    val uuid: String,
    val status: String = "",
    @SerialName("git_sha") val gitSha: String? = null,
    @SerialName("git_message") val gitMessage: String? = null,
    @SerialName("error_summary") val errorSummary: String? = null,
    @SerialName("error_hint") val errorHint: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("finished_at") val finishedAt: String? = null,
    val logs: String? = null,
    /** `production` (défaut) ou `dev`. */
    val environment: String? = null,
) {
    /** Déploiement de l'environnement dev (sinon prod). */
    val isDev: Boolean get() = environment.equals("dev", ignoreCase = true)
    val envLabel: String get() = if (isDev) "Dev" else "Prod"
    val isFailed: Boolean get() = status == "failed" || status == "error"
    val isRunning: Boolean get() = status in setOf("running", "queued", "building", "pending", "deploying")
    val isSuccess: Boolean get() = status in setOf("success", "ready", "completed", "live")
}

@Serializable
data class DeploymentLogs(
    val logs: String? = null,
    val status: String? = null,
)

@Serializable
data class Agent(
    val uuid: String,
    val name: String = "",
    val role: String = "",
    val kind: String = "",
    val status: String = "idle",
    val enabled: Int = 1,
    @SerialName("trigger_type") val triggerType: String = "",
    @SerialName("trigger_config") val triggerConfig: String = "",
    @SerialName("last_run_at") val lastRunAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

/** `GET /projects/{uuid}/status` : état Docker brut (`docker ps --format {{.Status}}`). */
@Serializable
data class ContainerStatus(
    val phase: String = "unknown",
    val healthy: Boolean = false,
    val message: String = "",
)

/** Réponse des actions start / stop / restart (`POST /projects/{uuid}/lifecycle/{action}`). */
@Serializable
data class LifecycleResult(
    val ok: Boolean = false,
    val phase: String? = null,
    val error: String? = null,
    val output: String? = null,
)

@Serializable
data class RuntimeLogs(
    val ok: Boolean = false,
    val logs: String = "",
    val error: String? = null,
)

@Serializable
data class GitSync(
    val state: String? = null,
    @SerialName("behind_by") val behindBy: Int? = null,
    @SerialName("ahead_by_remote") val aheadByRemote: Int? = null,
    @SerialName("deployed_sha") val deployedSha: String? = null,
    @SerialName("html_url") val htmlUrl: String? = null,
    @SerialName("files_count") val filesCount: Int? = null,
    val error: String? = null,
    @SerialName("head_sha") val headSha: String? = null,
    /** Commits sur GitHub pas encore en ligne (du plus ancien au plus récent). */
    val commits: List<GitCommit> = emptyList(),
)

@Serializable
data class GitCommit(
    val sha: String = "",
    val message: String = "",
    val author: String? = null,
    val date: String? = null,
)

@Serializable
data class GitFile(val status: String = "", val path: String = "")

@Serializable
data class GitWorkdir(
    val available: Boolean = false,
    val dirty: Boolean = false,
    val files: List<GitFile> = emptyList(),
)

/** `GET /projects/{uuid}/git` : synchro GitHub ↔ version en ligne, et brouillon local. */
@Serializable
data class GitInfo(
    val available: Boolean = false,
    val branch: String? = null,
    @SerialName("repo_url") val repoUrl: String? = null,
    val sync: GitSync? = null,
    val workdir: GitWorkdir? = null,
)

/** Aperçu brouillon (local, jamais publié). */
@Serializable
data class PreviewStatus(
    val status: String = "stopped",
    @SerialName("preview_url") val previewUrl: String? = null,
    @SerialName("public_ok") val publicOk: Boolean? = null,
) {
    val running: Boolean get() = status == "running" || status == "ready"
}

@Serializable
data class AgentMessage(
    val uuid: String? = null,
    val role: String,
    val content: String = "",
    val provider: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("tool_calls_json") val toolCallsJson: String? = null,
    @SerialName("attachments_json") val attachmentsJson: String? = null,
    @SerialName("reactions_json") val reactionsJson: String? = null,
    @SerialName("reply_to_uuid") val replyToUuid: String? = null,
) {
    val attachments: List<AttachmentInfo> get() = parseAttachments(attachmentsJson)
    val reactions: List<ReactionInfo> get() = parseReactions(reactionsJson)

    /** Les appels d'outils sont stockés en chaîne JSON ; une valeur invalide donne une liste vide. */
    val toolCalls: List<ToolCall>
        get() = parseToolCalls(toolCallsJson)

    /** Braise a proposé un plan → bouton « Construire en brouillon » (local, jamais publié). */
    val hasPlan: Boolean
        get() = toolCalls.any { tc ->
            tc.name == "propose_plan" &&
                ((tc.result as? JsonObject)?.get("plan") as? JsonObject)?.get("title") != null
        }
}

@Serializable
data class ToolCall(
    val name: String = "",
    val arguments: JsonElement? = null,
    val result: JsonElement? = null,
)

fun parseToolCalls(raw: String?): List<ToolCall> {
    if (raw.isNullOrBlank()) return emptyList()
    return runCatching { DevForgeJson.decodeFromString<List<ToolCall>>(raw) }.getOrDefault(emptyList())
}

@Serializable
data class SpecFeature(
    val slug: String,
    val title: String = "",
    val phase: String = "",
    val note: String = "",
    val dismissed: Boolean = false,
    @SerialName("updated_at") val updatedAt: String = "",
) {
    val awaitingValidation: Boolean get() = phase == "awaiting_validation" && !dismissed
}

@Serializable
data class SpecDetail(
    val slug: String? = null,
    val title: String? = null,
    val phase: String? = null,
    @SerialName("spec_md") val specMd: String? = null,
)

@Serializable
data class ChatReply(
    val reply: String = "",
    val provider: String? = null,
)

@Serializable
data class InboxEvent(
    val id: String,
    val kind: String,
    @SerialName("project_uuid") val projectUuid: String,
    @SerialName("project_name") val projectName: String = "",
    val title: String = "",
    val body: String = "",
    @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class Inbox(
    val events: List<InboxEvent> = emptyList(),
    @SerialName("server_time") val serverTime: String? = null,
)

@Serializable
data class Me(
    val email: String? = null,
    val name: String? = null,
)

/** Message d'erreur de l'API (`{"error": "..."}`), sinon null. */
fun apiErrorMessage(body: String?): String? {
    if (body.isNullOrBlank()) return null
    return runCatching {
        (DevForgeJson.parseToJsonElement(body) as? JsonObject)?.get("error")?.let {
            (it as? JsonPrimitive)?.contentOrNull
        }
    }.getOrNull()
}

/** Onglet Braise : dernière réplique de chaque conversation et ce qu'elle attend. */
@Serializable
data class Conversation(
    @SerialName("project_uuid") val projectUuid: String,
    @SerialName("project_name") val projectName: String = "",
    @SerialName("production_url") val productionUrl: String? = null,
    @SerialName("git_repository") val gitRepository: String? = null,
    @SerialName("last_role") val lastRole: String = "",
    val excerpt: String = "",
    @SerialName("created_at") val createdAt: String? = null,
    /** `spec` (spec à valider), `plan` (plan à lancer), `question`, ou null. */
    val waiting: String? = null,
    @SerialName("spec_title") val specTitle: String? = null,
    val working: Boolean = false,
)

@Serializable
data class Conversations(val conversations: List<Conversation> = emptyList())

/** `GET /android` : APK servi par l'instance. */
@Serializable
data class AndroidInfo(
    val available: Boolean = false,
    val version: String? = null,
    @SerialName("download_path") val downloadPath: String? = null,
    @SerialName("size_bytes") val sizeBytes: Long? = null,
)

/* ---------------- Brouillon (workdir local pas encore sur GitHub) ---------------- */

@Serializable
data class DraftFile(
    val path: String = "",
    /** `added` | `modified` | `deleted` | `renamed` */
    val status: String = "modified",
    @SerialName("old_path") val oldPath: String? = null,
    val origin: DraftOrigin? = null,
)

/** Qui a écrit le brouillon : `repair` | `feature` | `routine` | `manual` | `sync`. */
@Serializable
data class DraftOrigin(
    val kind: String = "manual",
    @SerialName("run_uuid") val runUuid: String? = null,
    @SerialName("agent_uuid") val agentUuid: String? = null,
    @SerialName("agent_name") val agentName: String? = null,
    @SerialName("deployment_uuid") val deploymentUuid: String? = null,
    @SerialName("recorded_at") val recordedAt: String? = null,
)

/** Recommandation : `keep` (Garder) | `review` (À vérifier) | `delete` (Peut être supprimé). */
@Serializable
data class DraftAdvice(val level: String = "review", val label: String = "", val reason: String = "")

@Serializable
data class DraftInsight(
    val behind: Int = 0,
    val overlap: List<String> = emptyList(),
    @SerialName("already_on_github") val alreadyOnGithub: List<String> = emptyList(),
)

@Serializable
data class DraftBackup(
    val id: String = "",
    @SerialName("created_at") val createdAt: String? = null,
    val reason: String = "discard",
    val files: List<String> = emptyList(),
    val deleted: List<String> = emptyList(),
)

@Serializable
data class DraftPreview(val running: Boolean = false, val url: String? = null)

@Serializable
data class DraftStatus(
    val available: Boolean = false,
    val reason: String? = null,
    val dirty: Boolean = false,
    val count: Int = 0,
    val files: List<DraftFile> = emptyList(),
    @SerialName("junk_count") val junkCount: Int = 0,
    val branch: String = "main",
    val ahead: Int = 0,
    val behind: Int = 0,
    @SerialName("has_remote") val hasRemote: Boolean = false,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("suggested_message") val suggestedMessage: String = "",
    val backups: List<DraftBackup> = emptyList(),
    val preview: DraftPreview = DraftPreview(),
    val origin: DraftOrigin? = null,
    @SerialName("origin_kinds") val originKinds: List<String> = emptyList(),
    val advice: DraftAdvice? = null,
    val insight: DraftInsight? = null,
    @SerialName("repair_succeeded_at") val repairSucceededAt: String? = null,
)

@Serializable
data class DraftDiffFile(
    val path: String = "",
    val status: String = "modified",
    @SerialName("old_path") val oldPath: String? = null,
    val additions: Int = 0,
    val deletions: Int = 0,
    val patch: String? = null,
)

@Serializable
data class DraftDiff(val files: List<DraftDiffFile> = emptyList())

@Serializable
data class DraftValidated(val sha: String = "", val files: Int = 0, val branch: String = "main")

@Serializable
data class DraftDiscarded(@SerialName("backup_id") val backupId: String = "", val files: Int = 0)

@Serializable
data class DraftRestored(val files: Int = 0)

/* ---- Corrections (vue simple, sans jargon) ---- */
@Serializable
data class CorrectionStep(val key: String = "", val label: String = "", val state: String = "todo")

@Serializable
data class CorrectionReport(
    val broke: String = "",
    val changed: String = "",
    val files: List<String> = emptyList(),
    @SerialName("test_ok") val testOk: Boolean? = null,
    val test: String = "",
    val todo: String = "",
)

@Serializable
data class Correction(
    val id: String = "",
    val stage: String = "",
    @SerialName("status_label") val statusLabel: String = "",
    val persona: String = "",
    val summary: String = "",
    val files: List<String> = emptyList(),
    val message: String? = null,
    val note: String? = null,
    val steps: List<CorrectionStep> = emptyList(),
    val report: CorrectionReport = CorrectionReport(),
    @SerialName("backup_id") val backupId: String? = null,
    val restorable: Boolean = false,
)

@Serializable
data class CorrectionsState(val current: Correction? = null, val history: List<Correction> = emptyList())

@Serializable
data class CorrectionApplied(
    val ok: Boolean = false,
    val deployed: Boolean = false,
    val conflict: Boolean = false,
    val message: String? = null,
)

@Serializable
data class OkOnly(val ok: Boolean = false)

@Serializable
data class DraftReverted(@SerialName("backup_id") val backupId: String = "", val path: String = "")

@Serializable
data class DraftUpdated(val merged: Int = 0, val head: String = "")

@Serializable
data class DraftSummary(
    @SerialName("project_uuid") val projectUuid: String = "",
    @SerialName("project_name") val projectName: String = "",
    @SerialName("production_url") val productionUrl: String? = null,
    @SerialName("git_repository") val gitRepository: String? = null,
    val count: Int = 0,
    val behind: Int = 0,
    @SerialName("updated_at") val updatedAt: String? = null,
    val origin: DraftOrigin? = null,
    val advice: DraftAdvice? = null,
)

@Serializable
data class DraftList(val drafts: List<DraftSummary> = emptyList())

/** `GET /projects/{uuid}/branches` : branche de prod + environnement dev. */
@Serializable
data class ProjectBranches(
    val production: ProdBranch = ProdBranch(),
    val dev: DevBranch = DevBranch(),
    @SerialName("auto_deploy") val autoDeploy: Boolean = false,
)

@Serializable
data class ProdBranch(
    val branch: String = "main",
    val url: String? = null,
)

@Serializable
data class DevBranch(
    val enabled: Boolean = false,
    val branch: String? = null,
    val url: String? = null,
    @SerialName("unsupported_reason") val unsupportedReason: String? = null,
    @SerialName("last_deployment") val lastDeployment: Deployment? = null,
)

@Serializable
data class BranchUpdate(
    val ok: Boolean = false,
    val data: ProjectBranches = ProjectBranches(),
    @SerialName("deployment_uuid") val deploymentUuid: String? = null,
)

@Serializable
data class GithubBranch(val name: String)

/** `owner/repo` d'une URL GitHub, sinon null. */
fun githubOwnerRepo(url: String?): Pair<String, String>? {
    val m = Regex("""github\.com[/:]([^/]+)/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$""", RegexOption.IGNORE_CASE)
        .find(url?.trim().orEmpty()) ?: return null
    return m.groupValues[1] to m.groupValues[2]
}

/* ---------------- Mémoire des agents (P3, écran natif) ---------------- */

@Serializable
data class MemoryItem(
    val uuid: String,
    val scope: String = "user",
    @SerialName("project_name") val projectName: String? = null,
    @SerialName("agent_name") val agentName: String? = null,
    val tier: String = "profile",
    val kind: String = "fact",
    val content: String = "",
    val source: String = "",
    val inferred: Boolean = false,
    val pinned: Boolean = false,
    @SerialName("created_by") val createdBy: String = "",
    @SerialName("created_by_name") val createdByName: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
)

@Serializable
data class MemoryBudget(val used: Int = 0, val max: Int = 0)

@Serializable
data class MemoryList(
    val ok: Boolean = true,
    val items: List<MemoryItem> = emptyList(),
    @SerialName("has_more") val hasMore: Boolean = false,
    @SerialName("profile_budget") val profileBudget: MemoryBudget = MemoryBudget(),
)

@Serializable
data class MemoryWriteResult(val ok: Boolean = false, val outcome: String = "", val uuid: String? = null)

@Serializable
data class MemoryOk(val ok: Boolean = false)

/* ---------------- Runs d'agent et cartes de job (P4) ---------------- */

@Serializable
data class RunMilestone(val label: String = "", val status: String = "running")

@Serializable
data class AgentRunInfo(
    @SerialName("run_uuid") val runUuid: String,
    val status: String = "running",
    val kind: String = "chat",
    val title: String? = null,
    val progress: List<RunMilestone> = emptyList(),
    val summary: String? = null,
    @SerialName("started_at") val startedAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    val error: String? = null,
    val attempts: Int = 0,
)

@Serializable
data class RunCancel(val ok: Boolean = false, val status: String = "")

/** Carte de job affichée dans le fil (délégation, résultat de worker, mise en ligne). */
data class JobInfo(
    val id: String,
    val kind: String,
    val title: String,
    val status: String,
    val summary: String? = null,
    val files: Int = 0,
    val milestones: List<RunMilestone> = emptyList(),
) {
    val live: Boolean get() = status == "queued" || status == "running"
    /** Bail SQL : run mis en pause par l'utilisateur (reprise possible). */
    val paused: Boolean get() = status == "paused"
}

/** Statut `agent_runs` / déploiement → statut de carte (`queued|running|paused|done|failed|cancelled`). */
fun jobStatus(raw: String?): String = when (raw?.lowercase()) {
    "queued" -> "queued"
    "paused" -> "paused"
    "completed", "done", "success", "succeeded" -> "done"
    "failed", "error", "timeout" -> "failed"
    "cancelled", "canceled" -> "cancelled"
    else -> "running"
}

private fun JsonObject.str(key: String): String =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim().orEmpty()

/** Cartes de job d'un message (un résultat de worker remplace la carte de délégation). */
fun jobsFromToolCalls(calls: List<ToolCall>): List<JobInfo> {
    val jobs = LinkedHashMap<String, JobInfo>()
    for (c in calls) {
        val r = c.result as? JsonObject ?: continue
        val okFalse = (r["ok"] as? JsonPrimitive)?.content == "false"
        when (c.name) {
            "delegate_task" -> {
                val id = r.str("run_uuid")
                if (id.isEmpty() || okFalse || jobs.containsKey(id)) continue
                jobs[id] = JobInfo(id, "worker", r.str("title").ifEmpty { "Tâche déléguée" }, jobStatus(r.str("status").let { if (it == "started" || it == "already_running") "running" else it }))
            }
            "job_result" -> {
                val id = r.str("run_uuid")
                if (id.isEmpty()) continue
                val files = (r["files"] as? kotlinx.serialization.json.JsonArray)?.size ?: 0
                jobs[id] = JobInfo(id, "worker", r.str("title").ifEmpty { "Tâche" }, jobStatus(r.str("status")), r.str("summary").ifEmpty { null }, files)
            }
            "trigger_deploy" -> {
                val id = r.str("deployment_uuid")
                if (id.isEmpty() || jobs.containsKey(id)) continue
                jobs[id] = JobInfo(id, "deploy", "Mise en ligne", jobStatus(r.str("status")), if (okFalse) r.str("error").ifEmpty { null } else null)
            }
        }
    }
    return jobs.values.toList()
}

/**
 * Statut réel des cartes : un `job_result` posté plus tard remplace la carte de délégation du même run,
 * puis les infos live (`agent_runs`) priment : un run en pause ou relancé après un échec reflète son
 * état réel (bail SQL), même si une carte de résultat a déjà été postée.
 */
fun mergeJobStatus(perMessage: List<List<JobInfo>>, live: Map<String, AgentRunInfo> = emptyMap()): List<List<JobInfo>> {
    val finished = perMessage.flatten().filter { it.kind == "worker" && !it.live }.associateBy { it.id }
    return perMessage.map { jobs ->
        jobs.map { j ->
            val done = finished[j.id]
            val run = if (j.kind == "worker") live[j.id] else null
            when {
                run != null -> j.copy(
                    status = jobStatus(run.status),
                    milestones = run.progress.ifEmpty { j.milestones },
                    summary = run.summary ?: run.error?.takeIf { jobStatus(run.status) == "failed" } ?: done?.summary ?: j.summary,
                    files = maxOf(done?.files ?: 0, j.files),
                )
                j.live && done != null -> j.copy(status = done.status, summary = done.summary ?: j.summary, files = maxOf(done.files, j.files))
                else -> j
            }
        }
    }
}
