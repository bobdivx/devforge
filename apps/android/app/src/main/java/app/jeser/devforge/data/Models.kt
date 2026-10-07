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
) {
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
) {
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
