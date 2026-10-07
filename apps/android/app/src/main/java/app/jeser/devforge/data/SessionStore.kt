package app.jeser.devforge.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

enum class AuthKind { OAuth, ApiToken }

/** Identifiants de l'instance. Les jetons ne sont jamais journalisés ni affichés. */
data class Session(
    val instanceUrl: String,
    val kind: AuthKind,
    val accessToken: String,
    val refreshToken: String? = null,
    /** Expiration de l'access token (epoch secondes), 0 = inconnue / pas d'expiration. */
    val expiresAt: Long = 0,
    val clientId: String? = null,
) {
    override fun toString(): String = "Session(instance=$instanceUrl, kind=$kind)"
}

interface SessionStore {
    fun load(): Session?
    fun save(session: Session)
    fun clear()

    /** Client OAuth enregistré (DCR) par instance : réutilisé entre connexions. */
    fun clientIdFor(instanceUrl: String): String?
    fun saveClientId(instanceUrl: String, clientId: String)

    /** Dernière URL saisie (pré-remplie à l'écran de connexion). */
    fun lastInstanceUrl(): String?

    /** Demande OAuth en cours (state + verifier), le temps du passage par le navigateur. */
    fun savePending(pending: PendingAuth)
    fun takePending(): PendingAuth?
}

data class PendingAuth(
    val instanceUrl: String,
    val clientId: String,
    val state: String,
    val verifier: String,
    val redirectUri: String,
    val tokenEndpoint: String,
)

/** Stockage chiffré (clé AES-256 dans le Keystore Android). */
class EncryptedSessionStore(context: Context) : SessionStore {
    private val prefs: SharedPreferences = run {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context,
            "devforge_secure",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    override fun load(): Session? {
        val url = prefs.getString("instance", null) ?: return null
        val token = prefs.getString("access", null) ?: return null
        val kind = runCatching { AuthKind.valueOf(prefs.getString("kind", "") ?: "") }.getOrNull() ?: return null
        return Session(
            instanceUrl = url,
            kind = kind,
            accessToken = token,
            refreshToken = prefs.getString("refresh", null),
            expiresAt = prefs.getLong("expires", 0),
            clientId = prefs.getString("client", null),
        )
    }

    override fun save(session: Session) = prefs.edit {
        putString("instance", session.instanceUrl)
        putString("last_instance", session.instanceUrl)
        putString("kind", session.kind.name)
        putString("access", session.accessToken)
        putString("refresh", session.refreshToken)
        putLong("expires", session.expiresAt)
        putString("client", session.clientId)
    }

    override fun clear() = prefs.edit {
        remove("instance"); remove("kind"); remove("access"); remove("refresh"); remove("expires"); remove("client")
    }

    override fun clientIdFor(instanceUrl: String): String? = prefs.getString("dcr:$instanceUrl", null)
    override fun saveClientId(instanceUrl: String, clientId: String) = prefs.edit { putString("dcr:$instanceUrl", clientId) }
    override fun lastInstanceUrl(): String? = prefs.getString("last_instance", null)

    override fun savePending(pending: PendingAuth) = prefs.edit {
        putString("p_instance", pending.instanceUrl)
        putString("p_client", pending.clientId)
        putString("p_state", pending.state)
        putString("p_verifier", pending.verifier)
        putString("p_redirect", pending.redirectUri)
        putString("p_token", pending.tokenEndpoint)
    }

    override fun takePending(): PendingAuth? {
        val p = PendingAuth(
            instanceUrl = prefs.getString("p_instance", null) ?: return null,
            clientId = prefs.getString("p_client", null) ?: return null,
            state = prefs.getString("p_state", null) ?: return null,
            verifier = prefs.getString("p_verifier", null) ?: return null,
            redirectUri = prefs.getString("p_redirect", null) ?: return null,
            tokenEndpoint = prefs.getString("p_token", null) ?: return null,
        )
        prefs.edit { listOf("p_instance", "p_client", "p_state", "p_verifier", "p_redirect", "p_token").forEach(::remove) }
        return p
    }
}

/** Implémentation mémoire (tests, captures). */
class InMemorySessionStore(private var session: Session? = null) : SessionStore {
    private val clients = mutableMapOf<String, String>()
    private var pending: PendingAuth? = null
    private var last: String? = session?.instanceUrl
    override fun load() = session
    override fun save(session: Session) { this.session = session; last = session.instanceUrl }
    override fun clear() { session = null }
    override fun clientIdFor(instanceUrl: String) = clients[instanceUrl]
    override fun saveClientId(instanceUrl: String, clientId: String) { clients[instanceUrl] = clientId }
    override fun lastInstanceUrl() = last
    override fun savePending(pending: PendingAuth) { this.pending = pending }
    override fun takePending() = pending.also { pending = null }
}
