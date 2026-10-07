package app.jeser.devforge

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.core.content.edit
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.jeser.devforge.auth.OAuth
import app.jeser.devforge.notify.InboxWorker
import app.jeser.devforge.notify.Notifier
import app.jeser.devforge.ui.HomeRoot
import app.jeser.devforge.ui.components.NotificationPrompt
import app.jeser.devforge.ui.login.LoginScreen
import app.jeser.devforge.ui.login.LoginViewModel
import app.jeser.devforge.ui.theme.DevForgeTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val graph by lazy { AppGraph.get(this) }
    private val loginVm: LoginViewModel by viewModels { viewModelFactory { initializer { LoginViewModel(graph) } } }

    /** Projet à ouvrir (notification touchée). */
    private var deepLinkProject by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        handleIntent(intent)

        lifecycleScope.launch {
            loginVm.browser.collect { url -> if (url != null) { openBrowser(url); loginVm.browserOpened() } }
        }
        lifecycleScope.launch {
            graph.signedIn.collect { signedIn -> if (signedIn) InboxWorker.schedule(this@MainActivity) else InboxWorker.cancel(this@MainActivity) }
        }

        val prefs = getSharedPreferences("devforge_ui", MODE_PRIVATE)
        setContent {
            DevForgeTheme {
                val signedIn by graph.signedIn.collectAsStateWithLifecycle()
                if (!signedIn) {
                    val st by loginVm.state.collectAsStateWithLifecycle()
                    LoginScreen(
                        state = st,
                        onLogin = loginVm::startOAuth,
                        onToggleServer = loginVm::toggleServerField,
                        onUrl = loginVm::onUrl,
                    )
                } else {
                    var selected by rememberSaveable { mutableStateOf<String?>(null) }
                    deepLinkProject?.let { selected = it; deepLinkProject = null }
                    // Android 13+ : permission demandée une fois, juste après la connexion, avec une explication.
                    var askNotif by rememberSaveable {
                        mutableStateOf(Build.VERSION.SDK_INT >= 33 && !Notifier.canNotify(this@MainActivity) && !prefs.getBoolean("notif_asked", false))
                    }
                    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
                    if (askNotif) {
                        NotificationPrompt(
                            onAccept = {
                                prefs.edit { putBoolean("notif_asked", true) }
                                askNotif = false
                                if (Build.VERSION.SDK_INT >= 33) permLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                            },
                            onLater = {
                                prefs.edit { putBoolean("notif_asked", true) }
                                askNotif = false
                            },
                        )
                    }
                    HomeRoot(
                        graph = graph,
                        selected = selected,
                        onSelect = { selected = it },
                        onSignOut = { graph.signOut() },
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        loginVm.browserReturnedWithoutResult()
    }

    private fun handleIntent(intent: Intent?) {
        intent ?: return
        // Build debug uniquement (supprimé du release) : session de test injectée par adb pour les smoke tests.
        if (BuildConfig.DEBUG) {
            intent.getStringExtra("debug_token")?.let { token ->
                val instance = intent.getStringExtra("debug_instance") ?: BuildConfig.DEFAULT_INSTANCE
                graph.store.save(app.jeser.devforge.data.Session(instance, app.jeser.devforge.data.AuthKind.ApiToken, token))
                graph.markSignedIn()
                intent.removeExtra("debug_token")
            }
        }
        val data = intent.data
        if (data != null && data.scheme == Uri.parse(OAuth.REDIRECT_URI).scheme) {
            loginVm.completeOAuth(data)
            intent.data = null
            return
        }
        intent.getStringExtra(Notifier.EXTRA_PROJECT)?.let {
            deepLinkProject = it
            intent.removeExtra(Notifier.EXTRA_PROJECT)
        }
    }

    private fun openBrowser(url: String) {
        val uri = Uri.parse(url)
        val tab = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
            .setDefaultColorSchemeParams(CustomTabColorSchemeParams.Builder().setToolbarColor(0xFF09090B.toInt()).build())
            .build()
        try {
            tab.launchUrl(this, uri)
        } catch (e: ActivityNotFoundException) {
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        }
    }
}
