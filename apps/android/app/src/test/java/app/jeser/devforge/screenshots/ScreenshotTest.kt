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
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.CompositionLocalProvider
import app.jeser.devforge.ui.theme.DevForgeTheme
import app.jeser.devforge.ui.HomeRootPreview
import app.jeser.devforge.ui.HomeTab
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
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
        compose.setContent { Shot { HomeRootPreview(SampleData.apps, hub = SampleData.hub) } }
        shot("apps")
    }

    @Test fun appsInbox() {
        compose.setContent { Shot { HomeRootPreview(SampleData.apps, initialInboxOpen = true, hub = SampleData.hub) } }
        shot("apps-inbox-sheet")
    }

    /**
     * Page app : statut unique + barre d'actions + tuiles (téléphone, tablette portrait) ;
     * grand écran paysage : la discussion reste visible à droite et occupe presque toute la hauteur.
     */
    private fun assertProjectLayout(what: String) {
        val root = compose.onRoot().getBoundsInRoot()
        val h = (root.bottom - root.top).value
        if (device.endsWith("land")) {
            val chatTop = compose.onNodeWithTag("chat").getBoundsInRoot().top
            assertTrue("en-tête trop haut ($what) : $chatTop sur $h dp", chatTop.value <= h * 0.30f)
        } else {
            compose.onNodeWithTag("status").assertExists()
            compose.onNodeWithTag("tiles").assertExists()
            val tilesBottom = compose.onNodeWithTag("tiles").getBoundsInRoot().bottom
            assertTrue("tuiles hors écran ($what) : $tilesBottom sur $h dp", tilesBottom.value <= h)
        }
        // Cibles tactiles de la barre d'actions ≥ 48 dp.
        val bar = compose.onNodeWithTag("actions").getBoundsInRoot()
        assertTrue("barre d'actions trop basse ($what) : ${bar.bottom - bar.top}", (bar.bottom - bar.top).value >= 48f)
    }

    @Test fun project() {
        compose.setContent { Shot { ProjectScreen(SampleData.project, ProjectActions(onBack = {})) } }
        shot("project")
        assertProjectLayout("app")
    }

    /** Braise en feuille : la zone de saisie reste entière à l'écran (pas de chat coupé). */
    @Test fun projectChatSheet() {
        compose.setContent { Shot { ProjectScreen(SampleData.project, ProjectActions(onBack = {}), initialSheet = ProjectSheet.Chat) } }
        shot("project-chat-sheet")
        // La feuille a sa propre fenêtre (2e racine) : on compare à celle-ci.
        val root = compose.onAllNodes(isRoot()).onLast().getBoundsInRoot()
        val input = compose.onAllNodesWithTag("chat-input").onFirst().getBoundsInRoot()
        assertTrue("saisie coupée : ${input.bottom} > ${root.bottom}", input.bottom <= root.bottom)
    }

    @Test fun projectDeploysSheet() {
        compose.setContent { Shot { ProjectScreen(SampleData.project, ProjectActions(onBack = {}), initialSheet = ProjectSheet.Deploys) } }
        shot("project-deploys-sheet")
    }

    @Test fun projectDetailsSheet() {
        compose.setContent { Shot { ProjectScreen(SampleData.project, ProjectActions(onBack = {}), initialSheet = ProjectSheet.Details) } }
        shot("project-details-sheet")
    }

    @Test fun branchesSection() {
        compose.setContent {
            Shot {
                androidx.compose.material3.Surface(color = app.jeser.devforge.ui.theme.DfColors.Surface) {
                    androidx.compose.foundation.layout.Column(
                        androidx.compose.ui.Modifier.padding(20.dp),
                        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(16.dp),
                    ) {
                        app.jeser.devforge.ui.project.BranchesContent(SampleData.branchesDev)
                        app.jeser.devforge.ui.project.BranchesContent(SampleData.branchesOff)
                        app.jeser.devforge.ui.project.BranchPickerContent(
                            "Branche de production", "Actuelle : main",
                            listOf("main", "devforge-dev-test", "feat/onboarding", "staging"), "main", "devforge-dev-test", {},
                        )
                    }
                }
            }
        }
        shot("project-branches")
    }

    @Test fun projectUpToDate() {
        compose.setContent { Shot { ProjectScreen(SampleData.projectUpToDate, ProjectActions(onBack = {})) } }
        shot("project-up-to-date")
    }

    @Test fun projectChangesPending() {
        compose.setContent { Shot { ProjectScreen(SampleData.projectPending, ProjectActions(onBack = {})) } }
        shot("project-changes-pending")
    }

    @Test fun publishConfirm() {
        compose.setContent { Shot { ProjectScreen(SampleData.projectPending, ProjectActions(onBack = {}), initialSheet = ProjectSheet.Deploy) } }
        shot("publish-confirm")
    }

    @Test fun projectDraft() {
        compose.setContent { Shot { ProjectScreen(SampleData.projectDraft, ProjectActions(onBack = {})) } }
        shot("project-draft")
        assertProjectLayout("brouillon")
    }

    @Test fun draftSheet() {
        compose.setContent { Shot { ProjectScreen(SampleData.projectDraft, ProjectActions(onBack = {}), initialSheet = ProjectSheet.Draft) } }
        shot("draft-sheet")
    }

    @Test fun draftFileSheet() {
        compose.setContent {
            Shot { ProjectScreen(SampleData.projectDraft, ProjectActions(onBack = {}), initialSheet = ProjectSheet.DraftFile, initialDraftPath = "src/components/Footer.astro") }
        }
        shot("draft-file")
    }

    @Test fun draftValidateSheet() {
        compose.setContent { Shot { ProjectScreen(SampleData.projectDraft, ProjectActions(onBack = {}), initialSheet = ProjectSheet.DraftValidate) } }
        shot("draft-validate")
    }

    @Test fun draftDiscardSheet() {
        compose.setContent { Shot { ProjectScreen(SampleData.projectDraft, ProjectActions(onBack = {}), initialSheet = ProjectSheet.DraftDiscard) } }
        shot("draft-discard")
    }

    @Test fun tabBraise() {
        compose.setContent { Shot { HomeRootPreview(SampleData.apps, tab = HomeTab.Braise, hub = SampleData.hub) } }
        shot("tab-braise")
    }

    @Test fun tabSettings() {
        compose.setContent { Shot { HomeRootPreview(SampleData.apps, tab = HomeTab.Settings, hub = SampleData.hub) } }
        shot("tab-settings")
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
                HomeRootPreview(SampleData.apps, hub = SampleData.hub)
                app.jeser.devforge.ui.components.NotificationPrompt({}, {})
            }
        }
        shot("notif-prompt")
    }

    /* Réglages → Mémoire (écran natif). */
    @Test fun memoryProfile() {
        compose.setContent { Shot { app.jeser.devforge.ui.memory.MemoryScreen(SampleData.memory, app.jeser.devforge.ui.memory.MemoryActions()) } }
        shot("memory-profile")
        // Onglets : cibles tactiles ≥ 48 dp.
        val tab = compose.onNodeWithTag("memory-tab-log").getBoundsInRoot()
        assertTrue("onglet trop petit : ${tab.bottom - tab.top}", (tab.bottom - tab.top).value >= 48f)
    }

    @Test fun memoryNotes() {
        compose.setContent { Shot { app.jeser.devforge.ui.memory.MemoryScreen(SampleData.memoryNotes, app.jeser.devforge.ui.memory.MemoryActions()) } }
        shot("memory-notes")
    }

    @Test fun memoryEmpty() {
        compose.setContent { Shot { app.jeser.devforge.ui.memory.MemoryScreen(app.jeser.devforge.ui.memory.MemoryUiState(tab = app.jeser.devforge.ui.memory.MemoryTab.Log, loading = false), app.jeser.devforge.ui.memory.MemoryActions()) } }
        shot("memory-empty")
    }

    @Test fun memoryForgetConfirm() {
        compose.setContent {
            Shot { app.jeser.devforge.ui.memory.MemoryScreen(SampleData.memory, app.jeser.devforge.ui.memory.MemoryActions(), initialSheet = app.jeser.devforge.ui.memory.MemorySheet.Forget(SampleData.memoryProfile[1])) }
        }
        shot("memory-forget-confirm")
    }

    @Test fun memoryPinConfirm() {
        compose.setContent {
            Shot { app.jeser.devforge.ui.memory.MemoryScreen(SampleData.memory, app.jeser.devforge.ui.memory.MemoryActions(), initialSheet = app.jeser.devforge.ui.memory.MemorySheet.Pin(SampleData.memoryProfile[2])) }
        }
        shot("memory-pin-confirm")
    }

    @Test fun memoryEdit() {
        compose.setContent {
            Shot { app.jeser.devforge.ui.memory.MemoryScreen(SampleData.memory, app.jeser.devforge.ui.memory.MemoryActions(), initialSheet = app.jeser.devforge.ui.memory.MemorySheet.Edit(SampleData.memoryProfile[0])) }
        }
        shot("memory-edit")
    }

    /* Braise : cartes de job (worker délégué en cours + terminé). */
    @Test fun projectChatJobs() {
        compose.setContent { Shot { ProjectScreen(SampleData.projectJobs, ProjectActions(onBack = {}), initialSheet = ProjectSheet.Chat) } }
        shot("project-chat-jobs")
    }

    /* Chat riche (P5) : question ouverte (options 48 dp), réactions, image jointe. */
    @Test fun projectChatRich() {
        compose.setContent { Shot { ProjectScreen(SampleData.projectRich, ProjectActions(onBack = {}), initialSheet = ProjectSheet.Chat) } }
        compose.onNodeWithTag("question-card").assertExists()
        val opt = compose.onNodeWithTag("question-option-yes").getBoundsInRoot()
        assertTrue("option < 48 dp", (opt.bottom - opt.top).value >= 48f)
        compose.onAllNodesWithTag("reactions").onFirst().assertExists()
        shot("project-chat-rich")
    }

    /* Question répondue : lecture seule « Tu as choisi : … » + bulle « ✓ ». */
    @Test fun projectChatAnswered() {
        compose.setContent { Shot { ProjectScreen(SampleData.projectRichAnswered, ProjectActions(onBack = {}), initialSheet = ProjectSheet.Chat) } }
        compose.onNodeWithTag("answer-bubble").assertExists()
        shot("project-chat-answered")
    }
}
