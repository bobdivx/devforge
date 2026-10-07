package app.jeser.devforge.auth

import android.net.Uri
import app.jeser.devforge.data.DevForgeJson
import app.jeser.devforge.data.PendingAuth
import app.jeser.devforge.data.apiErrorMessage
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.FormBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * Connexion OAuth 2.1 au serveur DevForge (PKCE S256 + enregistrement dynamique).
 * Le navigateur (Custom Tab) passe par le SSO de l'instance puis l'écran de consentement ;
 * le retour se fait sur [REDIRECT_URI]. Le scope `api` ouvre l'API REST à l'app.
 */
object OAuth {
    const val REDIRECT_URI = "app.jeser.devforge:/oauth/callback"
    const val SCOPE = "api offline_access"
    const val CLIENT_NAME = "DevForge Android"

    private val random = SecureRandom()

    fun randomUrlSafe(bytes: Int = 32): String {
        val b = ByteArray(bytes).also(random::nextBytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b)
    }

    /** RFC 7636 : challenge = BASE64URL(SHA256(verifier)). */
    fun challengeFor(verifier: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
    }

    /** Normalise l'adresse saisie : https par défaut, sans slash final ni chemin `/api/v1`. */
    fun normalizeInstance(raw: String): String? {
        var s = raw.trim().trimEnd('/')
        if (s.isEmpty()) return null
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
        s = s.removeSuffix("/api/v1").trimEnd('/')
        val uri = runCatching { java.net.URI(s) }.getOrNull() ?: return null
        if (uri.host.isNullOrBlank()) return null
        if (uri.scheme == "http" && uri.host !in setOf("localhost", "127.0.0.1", "10.0.2.2")) return null
        return s
    }

    fun authorizeUrl(
        authorizationEndpoint: String,
        clientId: String,
        state: String,
        challenge: String,
        redirectUri: String = REDIRECT_URI,
    ): String = Uri.parse(authorizationEndpoint).buildUpon()
        .appendQueryParameter("response_type", "code")
        .appendQueryParameter("client_id", clientId)
        .appendQueryParameter("redirect_uri", redirectUri)
        .appendQueryParameter("scope", SCOPE)
        .appendQueryParameter("state", state)
        .appendQueryParameter("code_challenge", challenge)
        .appendQueryParameter("code_challenge_method", "S256")
        .build().toString()

    sealed interface Callback {
        data class Code(val code: String) : Callback
        data class Error(val message: String) : Callback
    }

    /** Vérifie le `state` (anti-CSRF) et extrait le code ou l'erreur. */
    fun parseCallback(query: Map<String, String?>, expectedState: String): Callback {
        val error = query["error"]
        if (!error.isNullOrBlank()) {
            return Callback.Error(
                if (error == "access_denied") "Connexion refusée." else (query["error_description"] ?: error),
            )
        }
        if (query["state"] != expectedState) return Callback.Error("Réponse inattendue du navigateur. Recommence la connexion.")
        val code = query["code"]
        return if (code.isNullOrBlank()) Callback.Error("Code d'autorisation manquant.") else Callback.Code(code)
    }
}

@Serializable
data class ServerMetadata(
    @SerialName("authorization_endpoint") val authorizationEndpoint: String,
    @SerialName("token_endpoint") val tokenEndpoint: String,
    @SerialName("registration_endpoint") val registrationEndpoint: String? = null,
    @SerialName("scopes_supported") val scopesSupported: List<String> = emptyList(),
)

@Serializable
data class TokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("expires_in") val expiresIn: Long = 3600,
    val scope: String? = null,
) {
    override fun toString(): String = "TokenResponse(scope=$scope, expiresIn=$expiresIn)"
}

@Serializable
private data class RegistrationResponse(@SerialName("client_id") val clientId: String)

class OAuthException(message: String) : Exception(message)

/** Appels réseau OAuth (bloquants : à lancer sur Dispatchers.IO). */
class OAuthHttp(private val http: OkHttpClient) {
    fun discover(instance: String): ServerMetadata {
        val req = Request.Builder().url("$instance/.well-known/oauth-authorization-server").build()
        return runCatching {
            http.newCall(req).execute().use { res ->
                if (!res.isSuccessful) throw OAuthException("HTTP ${res.code}")
                DevForgeJson.decodeFromString<ServerMetadata>(res.body!!.string())
            }
        }.getOrElse {
            ServerMetadata("$instance/oauth/authorize", "$instance/oauth/token", "$instance/oauth/register")
        }
    }

    fun register(meta: ServerMetadata, instance: String): String {
        val endpoint = meta.registrationEndpoint ?: "$instance/oauth/register"
        val body = buildJsonObject {
            put("client_name", OAuth.CLIENT_NAME)
            put("redirect_uris", buildJsonArray { add(kotlinx.serialization.json.JsonPrimitive(OAuth.REDIRECT_URI)) })
            put("token_endpoint_auth_method", "none")
            put("grant_types", buildJsonArray {
                add(kotlinx.serialization.json.JsonPrimitive("authorization_code"))
                add(kotlinx.serialization.json.JsonPrimitive("refresh_token"))
            })
            put("response_types", buildJsonArray { add(kotlinx.serialization.json.JsonPrimitive("code")) })
            put("scope", OAuth.SCOPE)
        }.toString()
        val req = Request.Builder().url(endpoint)
            .post(body.toRequestBody("application/json".toMediaType())).build()
        http.newCall(req).execute().use { res ->
            val text = res.body?.string()
            if (!res.isSuccessful) throw OAuthException(apiErrorMessage(text) ?: oauthError(text) ?: "Enregistrement refusé (HTTP ${res.code})")
            return DevForgeJson.decodeFromString<RegistrationResponse>(text!!).clientId
        }
    }

    fun exchangeCode(pending: PendingAuth, code: String): TokenResponse = token(
        pending.tokenEndpoint,
        FormBody.Builder()
            .add("grant_type", "authorization_code")
            .add("code", code)
            .add("redirect_uri", pending.redirectUri)
            .add("client_id", pending.clientId)
            .add("code_verifier", pending.verifier)
            .build(),
    )

    fun refresh(tokenEndpoint: String, clientId: String, refreshToken: String): TokenResponse = token(
        tokenEndpoint,
        FormBody.Builder()
            .add("grant_type", "refresh_token")
            .add("refresh_token", refreshToken)
            .add("client_id", clientId)
            .build(),
    )

    private fun token(endpoint: String, form: FormBody): TokenResponse {
        val req = Request.Builder().url(endpoint).post(form).build()
        http.newCall(req).execute().use { res ->
            val text = res.body?.string()
            if (!res.isSuccessful) throw OAuthException(oauthError(text) ?: "Connexion refusée (HTTP ${res.code})")
            val t = DevForgeJson.decodeFromString<TokenResponse>(text!!)
            if (t.scope != null && t.scope.split(' ').none { it == "api" }) {
                throw OAuthException("Cette instance DevForge est trop ancienne pour l'app : mets-la à jour.")
            }
            return t
        }
    }

    private fun oauthError(text: String?): String? = runCatching {
        val o = DevForgeJson.parseToJsonElement(text ?: return null) as kotlinx.serialization.json.JsonObject
        (o["error_description"] ?: o["error"])?.let { (it as kotlinx.serialization.json.JsonPrimitive).content }
    }.getOrNull()
}
