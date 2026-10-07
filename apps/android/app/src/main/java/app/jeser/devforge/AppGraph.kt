package app.jeser.devforge

import android.content.Context
import app.jeser.devforge.auth.OAuthHttp
import app.jeser.devforge.data.ApiClient
import app.jeser.devforge.data.EncryptedSessionStore
import app.jeser.devforge.data.InboxEvent
import app.jeser.devforge.data.SessionStore
import app.jeser.devforge.data.TokenManager
import app.jeser.devforge.notify.InboxDiff
import app.jeser.devforge.notify.Notifier
import app.jeser.devforge.notify.PrefsInboxMemory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** Dépendances de l'app (petit conteneur manuel, sans framework d'injection). */
class AppGraph private constructor(private val context: Context) {
    val store: SessionStore = EncryptedSessionStore(context)
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    val oauth = OAuthHttp(http)

    private val _signedIn = MutableStateFlow(store.load() != null)
    val signedIn: StateFlow<Boolean> = _signedIn

    val tokens = TokenManager(store, { oauth }, onSignedOut = { _signedIn.value = false })
    val api = ApiClient({ store.load()?.instanceUrl }, tokens, http)
    val inboxMemory = PrefsInboxMemory(context)

    /** Dernière boîte de réception (affichée dans « À traiter »). */
    private val _inbox = MutableStateFlow<List<InboxEvent>>(emptyList())
    val inbox: StateFlow<List<InboxEvent>> = _inbox

    fun markSignedIn() {
        _signedIn.value = true
    }

    fun signOut() {
        store.clear()
        inboxMemory.reset()
        _inbox.value = emptyList()
        _signedIn.value = false
    }

    /** Arrière-plan : notifie les nouveautés. Premier plan : met à jour sans notifier (déjà à l'écran). */
    suspend fun syncInbox(notify: Boolean, probe: Boolean = true): List<InboxEvent> {
        val inbox = api.inbox(since = null, probe = probe)
        val diff = InboxDiff.compute(inbox.events, inboxMemory.seen(), notify)
        inboxMemory.saveSeen(diff.seen)
        _inbox.value = inbox.events
        if (notify) Notifier.show(context, diff.toNotify)
        return inbox.events
    }

    companion object {
        @Volatile private var instance: AppGraph? = null
        fun get(context: Context): AppGraph =
            instance ?: synchronized(this) { instance ?: AppGraph(context.applicationContext).also { instance = it } }
    }
}
