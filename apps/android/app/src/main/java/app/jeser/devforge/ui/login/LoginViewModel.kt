package app.jeser.devforge.ui.login

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.jeser.devforge.AppGraph
import app.jeser.devforge.auth.OAuth
import app.jeser.devforge.auth.OAuthException
import app.jeser.devforge.data.AuthKind
import app.jeser.devforge.data.PendingAuth
import app.jeser.devforge.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

data class LoginUiState(
    val instanceUrl: String = DEFAULT_INSTANCE,
    /** Champ « Autre serveur » (auto-hébergement) : caché par défaut, jamais obligatoire. */
    val showServerField: Boolean = false,
    val busy: Boolean = false,
    val waitingBrowser: Boolean = false,
    val error: String? = null,
)

val DEFAULT_INSTANCE: String = app.jeser.devforge.BuildConfig.DEFAULT_INSTANCE

class LoginViewModel(private val graph: AppGraph) : ViewModel() {
    private val _state = MutableStateFlow(
        (graph.store.lastInstanceUrl() ?: DEFAULT_INSTANCE).let { LoginUiState(instanceUrl = it, showServerField = it != DEFAULT_INSTANCE) },
    )
    val state: StateFlow<LoginUiState> = _state

    /** URL à ouvrir dans un Custom Tab (consommée par l'activité). */
    private val _browser = MutableStateFlow<String?>(null)
    val browser: StateFlow<String?> = _browser

    fun onUrl(v: String) = _state.update { it.copy(instanceUrl = v, error = null) }
    fun toggleServerField() = _state.update {
        if (it.showServerField) it.copy(showServerField = false, instanceUrl = DEFAULT_INSTANCE, error = null)
        else it.copy(showServerField = true, error = null)
    }
    fun browserOpened() { _browser.value = null }
    fun browserReturnedWithoutResult() = _state.update { if (it.waitingBrowser) it.copy(waitingBrowser = false, busy = false) else it }

    fun startOAuth() {
        val instance = OAuth.normalizeInstance(_state.value.instanceUrl)
            ?: return _state.update { it.copy(error = "Adresse invalide. Exemple : https://web.jeser.app") }
        _state.update { it.copy(busy = true, error = null, instanceUrl = instance) }
        viewModelScope.launch {
            try {
                val url = withContext(Dispatchers.IO) {
                    val meta = graph.oauth.discover(instance)
                    val clientId = graph.store.clientIdFor(instance)?.takeIf { it.isNotBlank() } ?: graph.oauth.register(meta, instance).also {
                        graph.store.saveClientId(instance, it)
                    }
                    val verifier = OAuth.randomUrlSafe(48)
                    val st = OAuth.randomUrlSafe(16)
                    graph.store.savePending(
                        PendingAuth(instance, clientId, st, verifier, OAuth.REDIRECT_URI, meta.tokenEndpoint),
                    )
                    OAuth.authorizeUrl(meta.authorizationEndpoint, clientId, st, OAuth.challengeFor(verifier))
                }
                _state.update { it.copy(waitingBrowser = true) }
                _browser.value = url
            } catch (e: OAuthException) {
                fail(e.message ?: "Connexion impossible.")
            } catch (e: IOException) {
                fail("Instance injoignable. Vérifie l'adresse et ta connexion.")
            }
        }
    }

    fun completeOAuth(uri: Uri) {
        val pending = graph.store.takePending()
            ?: return fail("Cette connexion a expiré. Recommence.")
        val query = uri.queryParameterNames.associateWith { uri.getQueryParameter(it) }
        when (val cb = OAuth.parseCallback(query, pending.state)) {
            is OAuth.Callback.Error -> fail(cb.message)
            is OAuth.Callback.Code -> {
                _state.update { it.copy(busy = true, waitingBrowser = false, error = null) }
                viewModelScope.launch {
                    try {
                        val t = withContext(Dispatchers.IO) { graph.oauth.exchangeCode(pending, cb.code) }
                        graph.store.save(
                            Session(
                                instanceUrl = pending.instanceUrl,
                                kind = AuthKind.OAuth,
                                accessToken = t.accessToken,
                                refreshToken = t.refreshToken,
                                expiresAt = System.currentTimeMillis() / 1000 + t.expiresIn,
                                clientId = pending.clientId,
                            ),
                        )
                        finishLogin()
                    } catch (e: OAuthException) {
                        if (e.message.orEmpty().contains("client", ignoreCase = true)) {
                            graph.store.saveClientId(pending.instanceUrl, "")
                        }
                        fail(e.message ?: "Connexion refusée.")
                    } catch (e: IOException) {
                        fail("Instance injoignable. Réessaie.")
                    }
                }
            }
        }
    }

    private fun finishLogin() {
        _state.update { it.copy(busy = false, waitingBrowser = false, error = null) }
        graph.markSignedIn()
    }

    private fun fail(msg: String) = _state.update { it.copy(busy = false, waitingBrowser = false, error = msg) }
}
