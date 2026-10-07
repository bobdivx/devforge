package app.jeser.devforge.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Ce que dit Docker du conteneur (`Up 3 hours (healthy)`, `Exited (137) 5 minutes ago`…). */
data class ContainerState(
    val kind: Kind,
    /** Durée lisible en français (« 3 h », « 2 j »), ou null. */
    val duration: String? = null,
    val health: Health = Health.None,
) {
    enum class Kind { Running, Restarting, Paused, Exited, Created, Missing, Unknown }
    enum class Health { Healthy, Unhealthy, Starting, None }

    val running: Boolean get() = kind == Kind.Running || kind == Kind.Restarting || kind == Kind.Paused
    /** Un conteneur existe (on peut le démarrer / l'arrêter). */
    val exists: Boolean get() = kind != Kind.Missing && kind != Kind.Unknown
}

private val DURATION = Regex(
    """(?i)(about an?|less than an?|\d+)\s+(second|minute|hour|day|week|month|year)s?""",
)

/** « 3 hours » → « 3 h », « About a minute » → « 1 min ». */
fun frenchDuration(raw: String): String? {
    val m = DURATION.find(raw) ?: return null
    val qty = m.groupValues[1].lowercase()
    val n = qty.toIntOrNull() ?: 1
    return when (m.groupValues[2].lowercase()) {
        "second" -> if (qty.startsWith("less")) "1 s" else "$n s"
        "minute" -> "$n min"
        "hour" -> "$n h"
        "day" -> "$n j"
        "week" -> "$n sem."
        "month" -> "$n mois"
        "year" -> if (n > 1) "$n ans" else "1 an"
        else -> null
    }
}

fun parseContainerStatus(status: ContainerStatus?): ContainerState {
    if (status == null) return ContainerState(ContainerState.Kind.Unknown)
    val msg = status.message.trim()
    val low = msg.lowercase()
    val health = when {
        "(healthy)" in low -> ContainerState.Health.Healthy
        "(unhealthy)" in low -> ContainerState.Health.Unhealthy
        "health: starting" in low -> ContainerState.Health.Starting
        else -> ContainerState.Health.None
    }
    val kind = when {
        status.phase == "unknown" && !low.startsWith("up") && !low.startsWith("exited") -> ContainerState.Kind.Unknown
        msg.isEmpty() || low == "aucun conteneur" -> ContainerState.Kind.Missing
        low.startsWith("up") && "(paused)" in low -> ContainerState.Kind.Paused
        low.startsWith("up") -> ContainerState.Kind.Running
        low.startsWith("restarting") -> ContainerState.Kind.Restarting
        low.startsWith("exited") || low.startsWith("dead") -> ContainerState.Kind.Exited
        low.startsWith("created") -> ContainerState.Kind.Created
        else -> ContainerState.Kind.Unknown
    }
    return ContainerState(kind, frenchDuration(msg), health)
}

/** État affiché en haut de la page app : une seule vérité, en mots simples. */
data class LiveSummary(
    val status: AppStatus,
    /** « depuis 3 h », « arrêtée il y a 5 min »… */
    val since: String?,
    /** Résultat du contrôle de santé, en clair. */
    val health: String,
    val healthOk: Boolean?,
)

fun liveSummary(
    project: Project?,
    container: ContainerState,
    latest: Deployment?,
    nowMillis: Long = System.currentTimeMillis(),
): LiveSummary {
    val probe = project?.status?.lowercase()
    val http = when (probe) {
        "live" -> true
        "unhealthy", "unrouted" -> false
        else -> null
    }
    val status = when {
        latest?.isRunning == true -> AppStatus.Deploying
        container.kind == ContainerState.Kind.Restarting -> AppStatus.Deploying
        project?.productionUrl.isNullOrBlank() && !container.exists && latest == null -> AppStatus.Draft
        container.running && (http == false || container.health == ContainerState.Health.Unhealthy) -> AppStatus.Down
        container.running -> AppStatus.Live
        latest?.isFailed == true && !container.running -> AppStatus.Failed
        container.kind == ContainerState.Kind.Exited || container.kind == ContainerState.Kind.Created -> AppStatus.Stopped
        container.kind == ContainerState.Kind.Missing && latest != null -> AppStatus.Stopped
        else -> project?.appStatus ?: AppStatus.Draft
    }
    val since = when {
        container.running && container.duration != null -> "depuis ${container.duration}"
        container.kind == ContainerState.Kind.Exited && container.duration != null -> "arrêtée il y a ${container.duration}"
        else -> null
    }
    val dockerHealth = when (container.health) {
        ContainerState.Health.Healthy -> "contrôle Docker OK"
        ContainerState.Health.Unhealthy -> "contrôle Docker en échec"
        ContainerState.Health.Starting -> "contrôle Docker en cours"
        ContainerState.Health.None -> null
    }
    val (health, ok) = when {
        status == AppStatus.Draft -> "Pas encore en ligne" to null
        !container.running && container.exists -> "Conteneur arrêté" to false
        probe == "unrouted" -> "Le domaine ne mène pas à l'app" to false
        http == false -> "Le site ne répond pas" to false
        http == true -> (listOfNotNull("Le site répond", dockerHealth).joinToString(" · ")) to (container.health != ContainerState.Health.Unhealthy)
        dockerHealth != null -> dockerHealth.replaceFirstChar { it.uppercase() } to (container.health == ContainerState.Health.Healthy)
        container.running -> "Conteneur démarré" to true
        else -> "État inconnu" to null
    }
    return LiveSummary(status, since, health, ok)
}

/** Synchro GitHub en une ligne (ou null si indisponible). */
fun syncLabel(info: GitInfo?): String? {
    val sync = info?.sync ?: return null
    if (!info.available) return null
    return when (sync.state) {
        "up_to_date" -> "GitHub : à jour"
        "behind" -> {
            val n = sync.behindBy ?: 0
            if (n > 0) "GitHub : $n commit${if (n > 1) "s" else ""} pas encore en ligne" else "GitHub : en avance sur la version en ligne"
        }
        "ahead" -> "GitHub : la version en ligne est en avance"
        "deploying" -> "GitHub : mise en ligne en cours"
        "no_deploy" -> "GitHub : jamais mis en ligne"
        "error" -> "GitHub : synchro impossible"
        "no_git" -> null
        else -> null
    }
}

/* ---------- Équipe (même logique que le web : personas.ts) ---------- */

enum class PersonaKey { Braise, Phare, Rustine, Plume }
enum class Tone { Ok, Warn, Danger, Neutral, Accent }

data class PersonaStatus(val key: PersonaKey, val label: String, val tone: Tone, val detail: String? = null, val agents: List<Agent> = emptyList())

private val PHARE_ROLES = setOf("ops", "deploy", "runner", "actions", "crons")
private val REPAIR_EVENTS = setOf("deploy_fail", "unhealthy", "unrouted")

private fun triggerEvent(a: Agent): String? {
    if (a.triggerType != "event" || a.triggerConfig.isBlank()) return null
    return runCatching {
        ((DevForgeJson.parseToJsonElement(a.triggerConfig) as? JsonObject)?.get("event") as? JsonPrimitive)?.contentOrNull
    }.getOrNull()
}

fun personaForAgent(a: Agent): PersonaKey? {
    if (a.role == "coordinator") return PersonaKey.Braise
    if (a.kind == "subagent" || a.role == "worker") return PersonaKey.Braise
    if (a.role == "reviewer") return PersonaKey.Plume
    if (a.role in PHARE_ROLES) return PersonaKey.Phare
    if (a.triggerType == "cron" || a.triggerType == "event") {
        val ev = triggerEvent(a)
        return if (ev != null && ev in REPAIR_EVENTS) PersonaKey.Rustine else PersonaKey.Phare
    }
    if (a.kind == "custom") return PersonaKey.Braise
    return null
}

fun teamStatus(agents: List<Agent>, specs: List<SpecFeature>, latest: Deployment?): List<PersonaStatus> {
    val by = PersonaKey.entries.associateWith { mutableListOf<Agent>() }
    agents.forEach { a -> personaForAgent(a)?.let { by.getValue(it).add(a) } }
    fun enabled(k: PersonaKey) = by.getValue(k).filter { it.enabled != 0 }

    val braise = run {
        val list = by.getValue(PersonaKey.Braise)
        val active = specs.filter { !it.dismissed }
        val awaiting = active.filter { it.phase == "awaiting_validation" }
        val building = active.filter { it.phase == "implement" }
        val ready = active.filter { it.phase == "converged" }
        when {
            awaiting.isNotEmpty() -> PersonaStatus(PersonaKey.Braise, "Attend ton OK", Tone.Warn, awaiting.first().title, list)
            list.any { it.status == "working" } || building.isNotEmpty() ->
                PersonaStatus(PersonaKey.Braise, "Construit…", Tone.Accent, building.firstOrNull()?.title, list)
            ready.isNotEmpty() -> PersonaStatus(PersonaKey.Braise, "Aperçu prêt", Tone.Ok, ready.first().title, list)
            list.isEmpty() -> PersonaStatus(PersonaKey.Braise, "Indisponible", Tone.Neutral, null, list)
            else -> PersonaStatus(PersonaKey.Braise, "Prête", Tone.Ok, null, list)
        }
    }
    val phare = run {
        val list = by.getValue(PersonaKey.Phare)
        val en = enabled(PersonaKey.Phare)
        when {
            list.isEmpty() -> PersonaStatus(PersonaKey.Phare, "Absent", Tone.Neutral, null, list)
            en.any { it.status == "working" } -> PersonaStatus(PersonaKey.Phare, "En ronde", Tone.Accent, null, list)
            en.isNotEmpty() -> PersonaStatus(PersonaKey.Phare, "Veille", Tone.Ok, null, list)
            else -> PersonaStatus(PersonaKey.Phare, "En pause", Tone.Neutral, null, list)
        }
    }
    val rustine = run {
        val list = by.getValue(PersonaKey.Rustine)
        val en = enabled(PersonaKey.Rustine)
        when {
            en.any { it.status == "working" } -> PersonaStatus(PersonaKey.Rustine, "Répare…", Tone.Accent, null, list)
            latest?.isFailed == true -> PersonaStatus(PersonaKey.Rustine, "Une panne à regarder", Tone.Danger, "La dernière mise en ligne a échoué", list)
            en.isNotEmpty() -> PersonaStatus(
                PersonaKey.Rustine, "Au repos", Tone.Ok,
                if (en.size > 1) "${en.size} alertes branchées" else "1 alerte branchée", list,
            )
            else -> PersonaStatus(PersonaKey.Rustine, "Au repos", Tone.Neutral, null, list)
        }
    }
    val plume = run {
        val list = by.getValue(PersonaKey.Plume)
        val en = enabled(PersonaKey.Plume)
        when {
            list.isEmpty() -> PersonaStatus(PersonaKey.Plume, "Absente", Tone.Neutral, null, list)
            en.any { it.status == "working" } -> PersonaStatus(PersonaKey.Plume, "Relit…", Tone.Accent, null, list)
            en.isNotEmpty() -> PersonaStatus(PersonaKey.Plume, "Disponible", Tone.Ok, null, list)
            else -> PersonaStatus(PersonaKey.Plume, "En pause", Tone.Neutral, null, list)
        }
    }
    return listOf(braise, phare, rustine, plume)
}

/* ---------- Icône d'app (mêmes sources que le web : AppIcon.tsx) ---------- */

fun hostnameFromUrl(raw: String?): String? {
    val first = raw?.split(',')?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val withProto = if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(first)) first else "https://$first"
    return runCatching { java.net.URI(withProto).host }.getOrNull()?.takeIf { it.isNotBlank() }
}

fun githubOwner(repo: String?): String? {
    if (repo.isNullOrBlank()) return null
    val cleaned = repo
        .replace(Regex("^https?://(www\\.)?github\\.com/", RegexOption.IGNORE_CASE), "")
        .replace(Regex("\\.git$", RegexOption.IGNORE_CASE), "")
        .replace(Regex("^git@github\\.com:", RegexOption.IGNORE_CASE), "")
    return cleaned.split('/').firstOrNull { it.isNotBlank() }
}

/** Sources d'icône : fichiers du site → services → avatar GitHub (même ordre que le web). */
fun appIconCandidates(productionUrl: String?, gitRepository: String?): List<String> {
    val out = mutableListOf<String>()
    hostnameFromUrl(productionUrl)?.let { host ->
        val origin = "https://$host"
        val h = java.net.URLEncoder.encode(host, "UTF-8")
        out += "$origin/apple-touch-icon.png"
        out += "$origin/apple-touch-icon-precomposed.png"
        out += "$origin/favicon.svg"
        out += "$origin/favicon.ico"
        out += "https://www.google.com/s2/favicons?sz=128&domain=$h"
        out += "https://icons.duckduckgo.com/ip3/$h.ico"
        out += "https://logo.clearbit.com/$h"
    }
    githubOwner(gitRepository)?.let { out += "https://github.com/${java.net.URLEncoder.encode(it, "UTF-8")}.png?size=128" }
    return out
}

/** Même hachage que le web (`(h * 31 + c) | 0`, valeur absolue). */
fun iconPaletteIndex(name: String, size: Int = 8): Int {
    var h = 0
    for (ch in name) h = h * 31 + ch.code
    return kotlin.math.abs(h) % size
}

fun iconInitials(name: String): String {
    val parts = name.trim().split(Regex("[\\s\\-_]+")).filter { it.isNotEmpty() }
    if (parts.size >= 2) return (parts[0].take(1) + parts[1].take(1)).uppercase()
    return name.take(2).uppercase().ifEmpty { "?" }
}

private val ANSI = Regex("\u001B\\[[0-9;?]*[A-Za-z]|\u001B\\][^\u0007]*\u0007")
private const val TS = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z "
private val DOCKER_TS = Regex("^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2})(?:\\.\\d+)?Z ")
private val INLINE_TS = Regex("(?<=[^\\n])(?=$TS)")
private val LOG_TS_FORMAT = java.time.format.DateTimeFormatter.ofPattern("dd/MM HH:mm:ss")

/**
 * Rend des logs lisibles sur un téléphone : retire les codes couleur ANSI, applique les retours
 * chariot comme un terminal (on garde ce qui reste affiché), supprime les lignes vides et
 * raccourcit l'horodatage Docker (« 2026-10-06T12:26:09.465Z ») en heure locale (« 06/10 14:26:09 »).
 */
fun cleanLogs(raw: String, zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String =
    raw.replace(ANSI, "").replace("\r\n", "\n").replace(INLINE_TS, "\n")
        .split('\n')
        .mapNotNull { line ->
            val m = DOCKER_TS.find(line)
            val body = (if (m != null) line.substring(m.range.last + 1) else line)
                .split('\r').lastOrNull { it.isNotBlank() }?.trimEnd()
                ?: return@mapNotNull null
            if (m == null) return@mapNotNull body
            val stamp = runCatching {
                java.time.LocalDateTime.parse(m.groupValues[1]).atZone(java.time.ZoneOffset.UTC)
                    .withZoneSameInstant(zone).format(LOG_TS_FORMAT)
            }.getOrDefault(m.groupValues[1])
            "$stamp  $body"
        }
        .joinToString("\n")

/* ---------- Mise en ligne : l'action suit l'état réel ---------- */

/**
 * « Mettre en ligne » prêtait à confusion quand l'app est déjà en ligne et à jour.
 * - commits GitHub pas encore en ligne → « Publier les changements » (principal) ;
 * - dernière mise en ligne échouée → « Réessayer la mise en ligne » (principal) ;
 * - jamais publiée → « Mettre en ligne » (principal) ;
 * - à jour (ou synchro inconnue) → pas de bouton principal, « Reconstruire » dans « Plus ».
 */
data class DeployPlan(
    val kind: Kind,
    val pending: Int = 0,
    val commits: List<GitCommit> = emptyList(),
    val upToDate: Boolean = false,
    val draftFiles: Int = 0,
) {
    enum class Kind { None, InProgress, Retry, FirstDeploy, PublishChanges, Rebuild }

    /** Bouton principal (bandeau violet) seulement s'il y a vraiment quelque chose à faire. */
    val primary: Boolean get() = kind == Kind.Retry || kind == Kind.FirstDeploy || kind == Kind.PublishChanges

    val label: String get() = when (kind) {
        Kind.PublishChanges -> "Publier les changements"
        Kind.Retry -> "Réessayer la mise en ligne"
        Kind.FirstDeploy -> "Mettre en ligne"
        Kind.Rebuild -> "Reconstruire"
        Kind.InProgress -> "Mise en ligne en cours…"
        Kind.None -> ""
    }

    /** Bouton court du bandeau. */
    val shortLabel: String get() = when (kind) {
        Kind.PublishChanges -> "Publier"
        Kind.Retry -> "Réessayer"
        Kind.FirstDeploy -> "Mettre en ligne"
        else -> label
    }

    /** Dernier commit en attente (le plus récent), première ligne. */
    val lastCommit: String? get() = commits.lastOrNull()?.message?.lineSequence()?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }

    val summary: String get() = when (kind) {
        Kind.PublishChanges -> "$pending changement${if (pending > 1) "s" else ""} sur GitHub" + (lastCommit?.let { " · « $it »" } ?: "")
        Kind.Retry -> "La dernière mise en ligne a échoué."
        Kind.FirstDeploy -> "L'app n'a jamais été publiée."
        Kind.Rebuild -> if (upToDate) "L'app est déjà à jour." else "Relance une construction depuis GitHub."
        Kind.InProgress -> "Construction depuis GitHub…"
        Kind.None -> ""
    }

    val rebuildExplanation: String get() =
        if (upToDate) "L'app est déjà à jour. Reconstruire relance une construction depuis GitHub sans changement de code."
        else "Reconstruire relance une construction depuis GitHub avec le code actuel de la branche."

    /** Note de journal envoyée avec la mise en ligne. */
    val message: String get() = when (kind) {
        Kind.PublishChanges -> "Publication de $pending changement${if (pending > 1) "s" else ""} depuis l'app Android"
        Kind.Retry -> "Nouvel essai de mise en ligne depuis l'app Android"
        Kind.FirstDeploy -> "Première mise en ligne depuis l'app Android"
        else -> "Reconstruction depuis l'app Android"
    }
}

fun deployPlan(hasRepo: Boolean, latest: Deployment?, git: GitInfo?, deploying: Boolean): DeployPlan {
    val draft = git?.workdir?.takeIf { it.available && it.dirty }?.files?.size ?: 0
    if (!hasRepo) return DeployPlan(DeployPlan.Kind.None, draftFiles = draft)
    if (deploying || latest?.isRunning == true) return DeployPlan(DeployPlan.Kind.InProgress, draftFiles = draft)
    if (latest?.isFailed == true) return DeployPlan(DeployPlan.Kind.Retry, draftFiles = draft)
    if (latest == null) return DeployPlan(DeployPlan.Kind.FirstDeploy, draftFiles = draft)
    val sync = git?.sync?.takeIf { git.available }
    val pending = if (sync?.state == "behind") (sync.behindBy ?: 0) else 0
    if (pending > 0) return DeployPlan(DeployPlan.Kind.PublishChanges, pending = pending, commits = sync?.commits.orEmpty(), draftFiles = draft)
    return DeployPlan(DeployPlan.Kind.Rebuild, upToDate = sync?.state == "up_to_date", draftFiles = draft)
}

/** « 2.0.199 » plus récent que « 2.0.198 » ? (comparaison numérique, suffixes ignorés). */
fun isNewerVersion(remote: String?, local: String?): Boolean {
    fun parts(v: String?) = v.orEmpty().substringBefore('-').split('.').map { it.trim().toIntOrNull() ?: 0 }
    val r = parts(remote)
    val l = parts(local)
    if (remote.isNullOrBlank() || r.all { it == 0 }) return false
    for (i in 0 until maxOf(r.size, l.size)) {
        val a = r.getOrElse(i) { 0 }
        val b = l.getOrElse(i) { 0 }
        if (a != b) return a > b
    }
    return false
}
