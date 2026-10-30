package app.jeser.devforge.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/* ---------------- Modèles d'agent (playbooks) et carte live d'un run ---------------- */

@Serializable
data class Playbook(
    val id: String,
    val slash: String = "",
    val name: String = "",
    val description: String = "",
    val steps: List<String> = emptyList(),
    val rule: String = "",
    val visual: String = "",
    @SerialName("goal_label") val goalLabel: String = "",
    @SerialName("goal_placeholder") val goalPlaceholder: String = "",
    @SerialName("uses_workers") val usesWorkers: Boolean = false,
)

@Serializable
data class PlaybookStarted(
    @SerialName("run_uuid") val runUuid: String,
    @SerialName("agent_uuid") val agentUuid: String? = null,
    val playbook: String? = null,
    val title: String? = null,
)

@Serializable
data class PlaybookRef(val id: String = "", val slash: String = "", val name: String = "", val rule: String = "", val visual: String = "")

@Serializable
data class LiveStep(val n: Int = 0, val label: String = "", val state: String = "pending")

@Serializable
data class LiveWorker(
    @SerialName("run_uuid") val runUuid: String,
    val title: String? = null,
    @SerialName("agent_name") val agentName: String? = null,
    val status: String = "queued",
    val live: Boolean = false,
    val summary: String? = null,
    val error: String? = null,
)

@Serializable
data class LiveCounters(
    @SerialName("tools_ok") val toolsOk: Int = 0,
    @SerialName("tools_failed") val toolsFailed: Int = 0,
    @SerialName("workers_total") val workersTotal: Int = 0,
    @SerialName("workers_done") val workersDone: Int = 0,
    @SerialName("workers_failed") val workersFailed: Int = 0,
    val decisions: Int = 0,
)

/** Une ligne « Montre-moi ton travail » : quoi, pourquoi, preuve (lien ou chemin), issue. */
@Serializable
data class RunDecision(
    val what: String = "",
    val why: String = "",
    val evidence: String = "",
    val outcome: String = "unknown",
    val step: Int? = null,
)

@Serializable
data class RunLive(
    @SerialName("run_uuid") val runUuid: String,
    @SerialName("project_uuid") val projectUuid: String = "",
    val status: String = "running",
    val live: Boolean = false,
    val verdict: String = "running",
    @SerialName("status_text") val statusText: String = "",
    val title: String? = null,
    val error: String? = null,
    val playbook: PlaybookRef? = null,
    val steps: List<LiveStep> = emptyList(),
    val workers: List<LiveWorker> = emptyList(),
    val counters: LiveCounters = LiveCounters(),
    val decisions: List<RunDecision> = emptyList(),
)

@Serializable
data class GrokWakeResult(val ok: Boolean = false, val status: Int? = null, val message: String = "", val event: String = "")

/** Libellé court d'une étape (même vocabulaire que le site). */
fun stepStateLabel(state: String): String = when (state) {
    "ok" -> "OK"
    "failed" -> "Échec"
    "running" -> "En cours"
    "missing" -> "Sans résultat"
    "skipped" -> "Ignorée"
    else -> "À venir"
}

/** État d'un worker ramené au vocabulaire des étapes. */
fun workerStepState(status: String): String = when (status) {
    "completed" -> "ok"
    "failed", "cancelled" -> "failed"
    "running" -> "running"
    else -> "pending"
}

fun verdictLabel(v: String): String = when (v) {
    "ok" -> "Réussi"
    "failed" -> "Échec"
    "incomplete" -> "Incomplet"
    else -> "En cours"
}

/** Pastilles compteurs : seules les valeurs utiles. */
fun livePills(c: LiveCounters): List<String> = buildList {
    if (c.workersTotal > 0) add("Workers ${c.workersDone}/${c.workersTotal}")
    add("${c.toolsOk} action${if (c.toolsOk > 1) "s" else ""} OK")
    if (c.toolsFailed > 0) add("${c.toolsFailed} échec${if (c.toolsFailed > 1) "s" else ""}")
    add("${c.decisions} décision${if (c.decisions > 1) "s" else ""}")
}

/** Preuve ouvrable dans le navigateur : http(s) uniquement. Un chemin reste du texte. */
fun evidenceUrl(evidence: String): String? {
    val e = evidence.trim()
    return if (Regex("^https?://[^\\s/]", RegexOption.IGNORE_CASE).containsMatchIn(e) && e.none { it.isWhitespace() }) e else null
}

val RunLive.needsHelp: Boolean get() = verdict == "failed" || verdict == "incomplete"
