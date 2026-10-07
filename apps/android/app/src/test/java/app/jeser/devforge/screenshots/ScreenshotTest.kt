package app.jeser.devforge.screenshots

import android.app.Application
import androidx.compose.ui.test.junit4.createComposeRule
import app.jeser.devforge.ui.login.LoginScreen
import app.jeser.devforge.ui.login.LoginUiState
import app.jeser.devforge.ui.project.ProjectActions
import app.jeser.devforge.ui.project.ProjectScreen
import app.jeser.devforge.ui.theme.DevForgeTheme
import app.jeser.devforge.ui.HomeRootPreview
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
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

    @Test fun login() {
        compose.setContent { DevForgeTheme { LoginScreen(LoginUiState(), {}, {}, {}) } }
        shot("login")
    }

    @Test fun apps() {
        compose.setContent { DevForgeTheme { HomeRootPreview(apps = SampleData.apps, project = SampleData.project) } }
        shot("apps")
    }

    @Test fun projectChat() {
        compose.setContent {
            DevForgeTheme { ProjectScreen(SampleData.project, ProjectActions(onBack = {})) }
        }
        shot("project-chat")
    }

    @Test fun notificationPrompt() {
        compose.setContent {
            DevForgeTheme {
                HomeRootPreview(apps = SampleData.apps, project = SampleData.project)
                app.jeser.devforge.ui.components.NotificationPrompt({}, {})
            }
        }
        shot("notif-prompt")
    }

    @Test fun deployConfirm() {
        compose.setContent {
            DevForgeTheme {
                ProjectScreen(
                    SampleData.project.copy(deployments = SampleData.deployments.drop(1)),
                    ProjectActions(onBack = {}),
                    initialDeployConfirm = true,
                )
            }
        }
        shot("deploy-confirm")
    }
}
