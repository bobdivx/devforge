package app.jeser.devforge.notify

import app.jeser.devforge.data.AppStatus
import app.jeser.devforge.data.Project

/** Avancement approximatif d'un déploiement (pour notif système + UI). */
data class DeployProgress(
    val projectUuid: String,
    val projectName: String,
    /** 0–100. */
    val percent: Int,
    val label: String,
    val detail: String?,
)

/**
 * Mappe le statut projet / carte deploy → pourcentage + libellé.
 * Pas de % réel côté API : on approxime par phase (file → build → mise en ligne).
 */
fun deployProgressOf(project: Project): DeployProgress? {
    if (project.appStatus != AppStatus.Deploying) return null
    val phase = (project.deploy?.status ?: project.status).lowercase()
    val (percent, label) = when (phase) {
        "queued", "pending" -> 12 to "En file d'attente…"
        "building" -> 42 to "Build en cours…"
        "running", "deploying" -> 72 to "Mise en ligne…"
        else -> 35 to "Déploiement…"
    }
    val detail = project.deploy?.message?.lineSequence()?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
    return DeployProgress(
        projectUuid = project.uuid,
        projectName = project.name,
        percent = percent,
        label = label,
        detail = detail,
    )
}

/** True si au moins un projet est en cours de déploiement. */
fun anyDeploying(projects: List<Project>): Boolean =
    projects.any { it.appStatus == AppStatus.Deploying }
