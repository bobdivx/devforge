package app.jeser.devforge.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/* P5 — chat riche côté Android : images jointes, réactions, questions `ask_user`. */

@Serializable
data class AttachmentInfo(
    val id: String,
    val url: String = "",
    val name: String = "image",
    val mime: String = "",
    val width: Int = 0,
    val height: Int = 0,
    val size: Long = 0,
)

@Serializable
data class ReactionInfo(val emoji: String, val count: Int = 1, val mine: Boolean = false)

@Serializable
data class ReactionsResponse(val ok: Boolean = true, val reactions: List<ReactionInfo> = emptyList())

@Serializable
data class AttachmentUpload(val ok: Boolean = true, val data: AttachmentInfo)

@Serializable
data class PublishApproval(val ok: Boolean = true, @SerialName("expires_in_seconds") val expiresInSeconds: Int = 0)

data class QuestionOption(
    val id: String,
    val label: String,
    val description: String? = null,
    val action: String = "reply",
    val style: String = "secondary",
)

data class QuestionInfo(val question: String, val options: List<QuestionOption>, val allowFreeText: Boolean = true)

data class AnswerInfo(val answerTo: String?, val optionId: String?, val label: String, val text: String? = null) {
    val display: String get() = if (!text.isNullOrBlank()) (if (label.isNotBlank() && label != "Autre") "$label — $text" else text) else label
}

/** Liste blanche (identique au serveur) ; la barre rapide en montre 6. */
val QUICK_REACTIONS = listOf("👍", "👎", "❤️", "🎉", "😄", "🤔")

private fun JsonObject.s(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

fun parseAttachments(raw: String?): List<AttachmentInfo> {
    if (raw.isNullOrBlank()) return emptyList()
    return runCatching { DevForgeJson.decodeFromString(ListSerializer(AttachmentInfo.serializer()), raw) }.getOrDefault(emptyList())
}

fun parseReactions(raw: String?): List<ReactionInfo> {
    if (raw.isNullOrBlank()) return emptyList()
    return runCatching { DevForgeJson.decodeFromString(ListSerializer(ReactionInfo.serializer()), raw) }.getOrDefault(emptyList())
}

/** Question `ask_user` posée dans ce message (dernière valide). */
fun questionFromToolCalls(calls: List<ToolCall>): QuestionInfo? {
    val r = calls.lastOrNull { it.name == "ask_user" }?.result as? JsonObject ?: return null
    if ((r["ok"] as? JsonPrimitive)?.booleanOrNull == false) return null
    val question = r.s("question") ?: return null
    val options = (r["options"] as? JsonArray).orEmpty().mapNotNull { o ->
        val obj = o as? JsonObject ?: return@mapNotNull null
        val id = obj.s("id") ?: return@mapNotNull null
        val label = obj.s("label") ?: return@mapNotNull null
        QuestionOption(id, label, obj.s("description"), obj.s("action") ?: "reply", obj.s("style") ?: "secondary")
    }
    if (options.size < 2) return null
    return QuestionInfo(question, options, (r["allow_free_text"] as? JsonPrimitive)?.booleanOrNull != false)
}

/** Réponse structurée portée par un message utilisateur. */
fun answerFromToolCalls(calls: List<ToolCall>): AnswerInfo? {
    val r = calls.firstOrNull { it.name == "answer" }?.result as? JsonObject ?: return null
    return AnswerInfo(r.s("answer_to"), r.s("option_id"), r.s("label").orEmpty(), r.s("text"))
}

/** Bascule optimiste d'une réaction (comme le web). */
fun toggleReaction(list: List<ReactionInfo>, emoji: String): List<ReactionInfo> {
    val cur = list.firstOrNull { it.emoji == emoji }
    return when {
        cur == null -> list + ReactionInfo(emoji, 1, true)
        cur.mine -> list.mapNotNull { if (it.emoji == emoji) it.copy(count = it.count - 1, mine = false).takeIf { r -> r.count > 0 } else it }
        else -> list.map { if (it.emoji == emoji) it.copy(count = it.count + 1, mine = true) else it }
    }
}

fun answerModelText(question: String, label: String, text: String? = null): String {
    val free = text?.trim().orEmpty()
    val ans = if (free.isNotEmpty() && label.isNotBlank()) "$label — $free" else free.ifEmpty { label }
    return if (question.isNotBlank()) "Réponse à ta question « ${question.trim()} » : $ans" else "Réponse : $ans"
}

/** Image choisie dans le composer, envoyée dès l'ajout. */
data class PendingImage(val localId: String, val name: String, val status: String = "uploading", val info: AttachmentInfo? = null, val error: String? = null, val preview: ByteArray? = null) {
    override fun equals(other: Any?): Boolean = other is PendingImage && other.localId == localId && other.status == status && other.info == info
    override fun hashCode(): Int = localId.hashCode() * 31 + status.hashCode()
}

const val MAX_IMAGE_BYTES = 10 * 1024 * 1024
val ACCEPTED_IMAGE_MIMES = setOf("image/png", "image/jpeg", "image/webp", "image/gif")
