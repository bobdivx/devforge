package app.jeser.devforge.data

import app.jeser.devforge.auth.OAuthHttp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

open class ApiException(val code: Int, message: String) : IOException(message)
class UnauthorizedException : ApiException(401, "Session expirée. Reconnecte-toi.")

/**
 * Fournit le jeton courant et le renouvelle (OAuth) avant expiration ou après un 401.
 * Un jeton API collé (`dfat_…`) n'expire pas côté app : un 401 déconnecte.
 */
class TokenManager(
    private val store: SessionStore,
    private val oauth: () -> OAuthHttp,
    private val now: () -> Long = { System.currentTimeMillis() / 1000 },
    private val onSignedOut: () -> Unit = {},
) {
    @Synchronized
    fun token(): String? {
        val s = store.load() ?: return null
        if (s.kind == AuthKind.OAuth && s.expiresAt > 0 && s.expiresAt - 60 <= now()) {
            return refreshLocked(s)
        }
        return s.accessToken
    }

    /** Après un 401 : renouvelle si personne ne l'a déjà fait entre-temps. */
    @Synchronized
    fun refreshAfter401(failedToken: String): String? {
        val s = store.load() ?: return null
        if (s.accessToken != failedToken) return s.accessToken
        if (s.kind != AuthKind.OAuth) {
            signOut(); return null
        }
        return refreshLocked(s)
    }

    private fun refreshLocked(s: Session): String? {
        val refresh = s.refreshToken
        val client = s.clientId
        if (refresh.isNullOrBlank() || client.isNullOrBlank()) {
            signOut(); return null
        }
        return try {
            val t = oauth().refresh("${s.instanceUrl}/oauth/token", client, refresh)
            val next = s.copy(
                accessToken = t.accessToken,
                refreshToken = t.refreshToken ?: refresh,
                expiresAt = now() + t.expiresIn,
            )
            store.save(next)
            next.accessToken
        } catch (e: ApiException) {
            signOut(); null
        } catch (e: app.jeser.devforge.auth.OAuthException) {
            signOut(); null
        } catch (e: IOException) {
            // Réseau absent : garder la session, réessayer plus tard.
            s.accessToken
        }
    }

    private fun signOut() {
        store.clear()
        onSignedOut()
    }
}

/** Client de l'API REST DevForge (`/api/v1`). Toutes les fonctions sont `suspend` et sûres pour l'UI. */
class ApiClient(
    private val baseUrlProvider: () -> String?,
    private val tokens: TokenManager,
    baseHttp: OkHttpClient = OkHttpClient(),
) {
    private val http: OkHttpClient = baseHttp.newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .addInterceptor(AuthInterceptor())
        .build()

    /** Flux de chat : la réponse arrive après plusieurs minutes, le serveur garde la main. */
    private val streamHttp: OkHttpClient = http.newBuilder()
        .readTimeout(10, TimeUnit.MINUTES)
        .callTimeout(15, TimeUnit.MINUTES)
        .build()

    private inner class AuthInterceptor : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val token = tokens.token() ?: throw UnauthorizedException()
            val first = chain.proceed(chain.request().withBearer(token))
            if (first.code != 401) return first
            first.close()
            val fresh = tokens.refreshAfter401(token) ?: throw UnauthorizedException()
            val second = chain.proceed(chain.request().withBearer(fresh))
            if (second.code == 401) {
                second.close()
                throw UnauthorizedException()
            }
            return second
        }
    }

    private fun Request.withBearer(token: String) = newBuilder()
        .header("Authorization", "Bearer $token")
        .header("Accept", header("Accept") ?: "application/json")
        .build()

    private fun url(path: String): String {
        val base = baseUrlProvider() ?: throw UnauthorizedException()
        return "$base/api/v1$path"
    }

    private suspend fun <T> call(request: Request, parse: (String) -> T): T = withContext(Dispatchers.IO) {
        http.newCall(request).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw ApiException(res.code, apiErrorMessage(text) ?: humanHttpError(res.code))
            }
            parse(text)
        }
    }

    private suspend fun <T> get(path: String, serializer: KSerializer<T>): T =
        call(Request.Builder().url(url(path)).get().build()) { DevForgeJson.decodeFromString(serializer, it) }

    private suspend fun <T> send(method: String, path: String, body: JsonObject, serializer: KSerializer<T>): T {
        val req = Request.Builder().url(url(path))
            .method(method, body.toString().toRequestBody(JSON))
            .build()
        return call(req) { DevForgeJson.decodeFromString(serializer, it) }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    suspend fun me(): Me = call(Request.Builder().url(url("/me")).get().build()) { text ->
        val user = DevForgeJson.parseToJsonElement(text).jsonObject["user"] as? JsonObject
        Me(
            email = (user?.get("email") as? JsonPrimitive)?.contentOrNull,
            name = (user?.get("name") as? JsonPrimitive)?.contentOrNull,
        )
    }

    suspend fun projects(): List<Project> =
        get("/projects", DataEnvelope.serializer(ListSerializer(Project.serializer()))).data

    /** `live=true` (booléen strict côté serveur) : statut sondé en direct. */
    suspend fun project(uuid: String, live: Boolean = true): ProjectDetail =
        get("/projects/${enc(uuid)}?live=$live", DataEnvelope.serializer(ProjectDetail.serializer())).data

    suspend fun deployments(uuid: String): List<Deployment> =
        get("/projects/${enc(uuid)}/deployments", DataEnvelope.serializer(ListSerializer(Deployment.serializer()))).data

    suspend fun deploymentLogs(deploymentUuid: String): String =
        call(Request.Builder().url(url("/deployments/${enc(deploymentUuid)}/logs")).get().build(), ::parseLogs)

    /** Seule action de publication de l'app : appelée après la feuille de confirmation. */
    suspend fun deploy(uuid: String, message: String): Deployment = send(
        "POST",
        "/projects/${enc(uuid)}/deployments",
        buildJsonObject { put("git_message", message) },
        DataEnvelope.serializer(Deployment.serializer()),
    ).data

    /** État du conteneur (lecture seule). */
    suspend fun containerStatus(uuid: String): ContainerStatus =
        get("/projects/${enc(uuid)}/status", DataEnvelope.serializer(ContainerStatus.serializer())).data

    /** Démarrer / Arrêter / Redémarrer : mêmes routes que le web. Arrêter et Redémarrer passent par une confirmation. */
    suspend fun lifecycle(uuid: String, action: String): LifecycleResult {
        require(action in setOf("start", "stop", "restart")) { "action inconnue" }
        return send(
            "POST",
            "/projects/${enc(uuid)}/lifecycle/${enc(action)}",
            buildJsonObject { },
            DataEnvelope.serializer(LifecycleResult.serializer()),
        ).data
    }

    suspend fun runtimeLogs(uuid: String, tail: Int = 200): RuntimeLogs =
        get("/projects/${enc(uuid)}/runtime-logs?tail=$tail", DataEnvelope.serializer(RuntimeLogs.serializer())).data

    suspend fun git(uuid: String): GitInfo = get("/projects/${enc(uuid)}/git", GitInfo.serializer())

    suspend fun preview(uuid: String): PreviewStatus =
        get("/projects/${enc(uuid)}/preview", DataEnvelope.serializer(PreviewStatus.serializer())).data

    /** Lance l'aperçu brouillon (local) : rien n'est publié. */
    suspend fun startPreview(uuid: String): PreviewStatus = send(
        "POST",
        "/projects/${enc(uuid)}/preview/start",
        buildJsonObject { },
        DataEnvelope.serializer(PreviewStatus.serializer()),
    ).data

    suspend fun agents(uuid: String): List<Agent> =
        get("/projects/${enc(uuid)}/agents", DataEnvelope.serializer(ListSerializer(Agent.serializer()))).data

    suspend fun messages(uuid: String, agentUuid: String): List<AgentMessage> = get(
        "/projects/${enc(uuid)}/agents/${enc(agentUuid)}/messages",
        DataEnvelope.serializer(ListSerializer(AgentMessage.serializer())),
    ).data

    suspend fun specs(uuid: String): List<SpecFeature> =
        get("/projects/${enc(uuid)}/specs", DataEnvelope.serializer(ListSerializer(SpecFeature.serializer()))).data

    suspend fun spec(uuid: String, slug: String): Pair<SpecFeature, String> =
        call(Request.Builder().url(url("/projects/${enc(uuid)}/specs/${enc(slug)}")).get().build(), ::parseSpec)

    suspend fun createSpec(uuid: String, title: String, description: String): SpecFeature = send(
        "POST",
        "/projects/${enc(uuid)}/specs",
        buildJsonObject { put("title", title); put("description", description) },
        DataEnvelope.serializer(SpecFeature.serializer()),
    ).data

    /** Validation explicite (bouton Approuver / Refuser) — jamais déduite d'un message. */
    suspend fun decideSpec(uuid: String, slug: String, approve: Boolean, note: String = ""): SpecFeature = send(
        "POST",
        "/projects/${enc(uuid)}/specs/${enc(slug)}/decision",
        buildJsonObject { put("decision", if (approve) "approve" else "reject"); put("note", note) },
        DataEnvelope.serializer(SpecFeature.serializer()),
    ).data

    suspend fun conversations(): List<Conversation> =
        get("/mobile/conversations", DataEnvelope.serializer(Conversations.serializer())).data.conversations

    suspend fun androidInfo(): AndroidInfo = get("/android", DataEnvelope.serializer(AndroidInfo.serializer())).data

    /** URL absolue de l'APK servi par l'instance (téléchargement dans le navigateur). */
    fun apkUrl(path: String?): String? = path?.let { url(it.removePrefix("/api/v1")) }

    suspend fun inbox(since: String?, probe: Boolean = true): Inbox {
        val q = buildString {
            append("?probe=").append(probe)
            if (!since.isNullOrBlank()) append("&since=").append(enc(since))
        }
        return get("/mobile/inbox$q", DataEnvelope.serializer(Inbox.serializer())).data
    }

    /**
     * Envoie un message au fil du coordinateur et lit le flux SSE jusqu'à la réponse.
     * Le serveur continue même si la connexion tombe : l'appelant recharge alors le fil.
     */
    suspend fun chat(
        projectUuid: String,
        agentUuid: String,
        message: String,
        onProgress: (String) -> Unit,
    ): ChatReply = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("message", message)
            put("stream", true)
            put("project_uuid", projectUuid)
            put("agent_uuid", agentUuid)
        }
        val req = Request.Builder().url(url("/agent/chat"))
            .header("Accept", "text/event-stream")
            .post(body.toString().toRequestBody(JSON))
            .build()
        streamHttp.newCall(req).execute().use { res ->
            if (!res.isSuccessful) {
                val text = res.body?.string()
                throw ApiException(res.code, apiErrorMessage(text) ?: humanHttpError(res.code))
            }
            val ctype = res.header("Content-Type").orEmpty()
            val source = res.body!!.source()
            if (!ctype.contains("text/event-stream")) {
                val text = source.readUtf8()
                return@withContext DevForgeJson.decodeFromString(DataEnvelope.serializer(ChatReply.serializer()), text).data
            }
            val parser = SseParser()
            while (true) {
                val line = source.readUtf8Line() ?: break
                val ev = parser.feed(line) ?: continue
                when (ev) {
                    is ChatEvent.Progress -> onProgress(ev.label)
                    is ChatEvent.Reply -> return@withContext ChatReply(ev.content, ev.provider)
                    is ChatEvent.Failure -> throw ApiException(500, ev.message)
                }
            }
            throw IOException("Flux interrompu")
        }
    }

    companion object {
        private val JSON = "application/json".toMediaType()

        fun humanHttpError(code: Int): String = when (code) {
            401 -> "Session expirée. Reconnecte-toi."
            403 -> "Accès refusé."
            404 -> "Introuvable."
            429 -> "Trop de demandes, réessaie dans un instant."
            502, 503, 504, 524 -> "Le serveur ne répond pas pour l'instant. Réessaie."
            else -> "Erreur du serveur ($code)."
        }

        fun parseLogs(text: String): String {
            val root = runCatching { DevForgeJson.parseToJsonElement(text).jsonObject }.getOrNull() ?: return text
            val holder = (root["data"] as? JsonObject) ?: root
            return (holder["logs"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        }

        fun parseSpec(text: String): Pair<SpecFeature, String> {
            val root = DevForgeJson.parseToJsonElement(text).jsonObject
            val feature = DevForgeJson.decodeFromJsonElement(SpecFeature.serializer(), root["data"]!!)
            val md = (root["spec_md"] as? JsonPrimitive)?.contentOrNull.orEmpty()
            return feature to md
        }
    }
}

sealed interface ChatEvent {
    data class Progress(val label: String) : ChatEvent
    data class Reply(val content: String, val provider: String?) : ChatEvent
    data class Failure(val message: String) : ChatEvent
}

/** Lecteur SSE ligne à ligne (`data:` accumulé jusqu'à la ligne vide). */
class SseParser {
    private val data = StringBuilder()

    fun feed(line: String): ChatEvent? {
        if (line.isEmpty()) {
            if (data.isEmpty()) return null
            val payload = data.toString()
            data.clear()
            return decode(payload)
        }
        if (line.startsWith("data:")) {
            if (data.isNotEmpty()) data.append('\n')
            data.append(line.removePrefix("data:").trimStart())
        }
        return null
    }

    private fun decode(payload: String): ChatEvent? {
        val o = runCatching { DevForgeJson.parseToJsonElement(payload).jsonObject }.getOrNull() ?: return null
        fun s(k: String) = (o[k] as? JsonPrimitive)?.contentOrNull
        return when (s("type")) {
            "thinking" -> s("label")?.takeIf { it.isNotBlank() }?.let { ChatEvent.Progress(it) }
            "tool_start" -> s("name")?.let { ChatEvent.Progress(toolLabel(it)) }
            "reply" -> ChatEvent.Reply(s("content").orEmpty(), s("provider"))
            "error" -> ChatEvent.Failure(s("message") ?: "Erreur de l'agent")
            else -> null
        }
    }

    companion object {
        fun toolLabel(name: String): String = when {
            name.contains("deploy") -> "Prépare la mise en ligne…"
            name.contains("write") || name.contains("edit") -> "Écrit le brouillon…"
            name.contains("read") || name.contains("list") -> "Lit le projet…"
            name.contains("preview") -> "Lance l'aperçu…"
            name.contains("log") -> "Lit les logs…"
            else -> name.replace('_', ' ') + "…"
        }
    }
}
