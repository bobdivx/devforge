package app.jeser.devforge.screenshots

import android.app.Application
import androidx.compose.ui.test.junit4.createComposeRule
import app.jeser.devforge.ui.login.LoginScreen
import app.jeser.devforge.ui.login.LoginUiState
import app.jeser.devforge.ui.project.ProjectActions
import app.jeser.devforge.ui.project.ProjectScreen
import app.jeser.devforge.ui.project.ProjectSheet
import app.jeser.devforge.ui.project.RuntimeLogsState
import app.jeser.devforge.ui.project.LogsState
import app.jeser.devforge.ui.components.LocalLoadRemoteIcons
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import app.jeser.devforge.ui.theme.DevForgeTheme
import app.jeser.devforge.ui.HomeRootPreview
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Captures Compose (Roborazzi) : téléphone 360x800 et 412x915, tablette 800x1280 et paysage.
 * `./gradlew recordRoborazziDebug` écrit les PNG dans `devforge.shotsDir`.
 */
@OptIn(ExperimentalRoborazziApi::class)
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class)
class ScreenshotTest(private val device: String, private val qualifiers: String) {

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun devices() = listOf(
            arrayOf("phone-360x800", "w360dp-h800dp-port-xhdpi"),
            arrayOf("phone-412x915", "w412dp-h915dp-port-xhdpi"),
            arrayOf("tablet-800x1280", "w800dp-h1280dp-port-xhdpi"),
            arrayOf("tablet-1280x800-land", "w1280dp-h800dp-land-xhdpi"),
        )
    }

    @get:Rule val compose = createComposeRule()

    private val dir: String get() = System.getProperty("devforge.shotsDir") ?: "build/shots"

    @Before fun device() {
        RuntimeEnvironment.setQualifiers(qualifiers)
    }

    private fun shot(name: String) {
        compose.waitForIdle()
        captureScreenRoboImage("$dir/$name-$device.png")
    }

    @Composable
    private fun Shot(content: @Composable () -> Unit) {
        DevForgeTheme { CompositionLocalProvider(LocalLoadRemoteIcons provides false) { content() } }
    }

    @Test fun login() {
        compose.setContent { Shot { LoginScreen(LoginUiState(), {}, {}, {}) } }
        shot("login")
    }

    @Test fun apps() {
        compose.setContent { Shot { HomeRootPreview(SampleData.apps) } }
        shot("apps")
    }

    @Test fun appsInbox() {
        compose.setContent { Shot { HomeRootPreview(SampleData.apps, initialInboxOpen = true) } }
        shot("apps-inbox-sheet")
    }

    @Test fun project() {
        compose.setContent { Shot { ProjectScreen(SampleData.project, ProjectActions(onBack = {})) } }
        shot("project")
        // La discussion garde l'essentiel de l'écran : en-tête (barre + bande d'état) ≤ 30 % de la hauteur.
        if (!device.endsWith("land")) {
            val root = compose.onRoot().getBoundsInRoot()
            val chatTop = compose.onNodeWithTag("chat").getBoundsInRoot().top
            val h = (root.bottom - root.top).value
            assertTrue("en-tête trop haut : $chatTop sur $h dp", chatTop.value <= h * 0.30f)
        }
    }

    @Test fun projectDetailsSheet() {
        compose.setContent { Shot { ProjectScreen(SampleData.project, ProjectActions(onBack = {}), initialSheet = ProjectSheet.Details) } }
        shot("project-details-sheet")
    }

    @Test fun projectMoreSheet() {
        compose.setContent { Shot { ProjectScreen(SampleData.project, ProjectActions(onBack = {}), initialSheet = ProjectSheet.More) } }
        shot("project-more-sheet")
    }

    @Test fun projectLogs() {
        val st = SampleData.project.copy(
            runtimeLogs = RuntimeLogsState(
                text = (1..40).joinToString("\n") { "2026-10-07T12:${10 + it % 50}:00.123456789Z \u001B[32mGET\u001B[39m /api/health 200 ${3 + it % 7}ms" },
                loading = false,
            ),
            logs = LogsState(
                SampleData.deployments.first(),
                text = "> npm run build\nnpm ERR! Missing script: \"build\"\nnpm ERR! To see a list of scripts, run:\nnpm ERR!   npm run",
                loading = false,
            ),
        )
        compose.setContent { Shot { ProjectScreen(st, ProjectActions(onBack = {})) } }
        shot("project-logs")
    }

    @Test fun restartConfirm() {
        compose.setContent { Shot { ProjectScreen(SampleData.project, ProjectActions(onBack = {}), initialSheet = ProjectSheet.Restart) } }
        shot("restart-confirm")
    }

    @Test fun deployConfirm() {
        compose.setContent {
            Shot {
                ProjectScreen(
                    SampleData.project.copy(deployments = SampleData.deployments.drop(1)),
                    ProjectActions(onBack = {}),
                    initialSheet = ProjectSheet.Deploy,
                )
            }
        }
        shot("deploy-confirm")
    }

    @Test fun notificationPrompt() {
        compose.setContent {
            Shot {
                HomeRootPreview(SampleData.apps)
                app.jeser.devforge.ui.components.NotificationPrompt({}, {})
            }
        }
        shot("notif-prompt")
    }
}
