package app.jeser.devforge.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Surface
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.jeser.devforge.AppGraph
import app.jeser.devforge.ui.apps.AppsScreen
import app.jeser.devforge.ui.apps.AppsViewModel
import app.jeser.devforge.ui.components.Persona
import app.jeser.devforge.ui.components.PersonaMessage
import app.jeser.devforge.ui.project.ProjectActions
import app.jeser.devforge.ui.project.ProjectScreen
import app.jeser.devforge.ui.project.ProjectViewModel
import app.jeser.devforge.ui.theme.DfColors

/** Largeur à partir de laquelle on affiche liste + détail côte à côte (tablette, paysage). */
val TWO_PANE_MIN_WIDTH = 700.dp

@Composable
fun HomeRoot(
    graph: AppGraph,
    selected: String?,
    onSelect: (String?) -> Unit,
    onSignOut: () -> Unit,
) {
    val appsVm: AppsViewModel = viewModel(factory = viewModelFactory { initializer { AppsViewModel(graph) } })
    val apps by appsVm.state.collectAsStateWithLifecycle()
    LifecycleStartEffect(Unit) {
        appsVm.startPolling()
        onStopOrDispose { appsVm.stopPolling() }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val twoPane = maxWidth >= TWO_PANE_MIN_WIDTH
        val wideList = maxWidth >= 1000.dp
        val listPane: @Composable (Modifier) -> Unit = { m ->
            AppsScreen(
                state = apps,
                selectedUuid = if (twoPane) selected else null,
                onRefresh = { appsVm.refresh() },
                onOpen = { onSelect(it) },
                onSignOut = onSignOut,
                modifier = m,
            )
        }
        if (twoPane) {
            // Sélection par défaut : première app, pour ne jamais laisser le détail vide.
            LaunchedEffect(apps.projects, selected) {
                if (selected == null) apps.projects.firstOrNull()?.let { onSelect(it.uuid) }
            }
            Row(Modifier.fillMaxSize()) {
                val listWidth = if (wideList) 380.dp else 320.dp
                listPane(Modifier.width(listWidth).fillMaxHeight())
                VerticalDivider(color = DfColors.Line)
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    if (selected != null) {
                        ProjectRoute(graph, selected, onBack = null, onChanged = { appsVm.refresh() })
                    } else {
                        Surface(color = DfColors.Bg, modifier = Modifier.fillMaxSize()) {
                            Box(contentAlignment = Alignment.Center) {
                                PersonaMessage(Persona.Braise, "Choisis une app", "Braise t'attend dans le projet.")
                            }
                        }
                    }
                }
            }
        } else {
            if (selected == null) {
                listPane(Modifier.fillMaxSize())
            } else {
                BackHandler { onSelect(null) }
                ProjectRoute(graph, selected, onBack = { onSelect(null) }, onChanged = { appsVm.refresh() })
            }
        }
    }
}

@Composable
private fun ProjectRoute(graph: AppGraph, uuid: String, onBack: (() -> Unit)?, onChanged: () -> Unit) {
    val vm: ProjectViewModel = viewModel(
        key = "project:$uuid",
        factory = viewModelFactory { initializer { ProjectViewModel(graph, uuid) } },
    )
    val state by vm.state.collectAsStateWithLifecycle()
    LifecycleStartEffect(uuid) {
        vm.startPolling()
        onStopOrDispose { vm.stopPolling() }
    }
    LaunchedEffect(state.project?.status) { if (state.project != null) onChanged() }
    ProjectScreen(
        state = state,
        actions = ProjectActions(
            onBack = onBack,
            onRetry = vm::load,
            onSend = vm::send,
            onDeploy = vm::deploy,
            onOpenLogs = vm::openLogs,
            onCloseLogs = vm::closeLogs,
            onOpenSpec = vm::openSpec,
            onCloseSpec = vm::closeSpec,
            onDecideSpec = vm::decideSpec,
            onCreateSpec = vm::createSpec,
            onNoticeShown = vm::noticeShown,
        ),
    )
}

/** Même mise en page adaptative, sans ViewModel (captures, aperçus). */
@Composable
fun HomeRootPreview(apps: app.jeser.devforge.ui.apps.AppsUiState, project: app.jeser.devforge.ui.project.ProjectUiState) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val twoPane = maxWidth >= TWO_PANE_MIN_WIDTH
        val listWidth = if (maxWidth >= 1000.dp) 380.dp else 320.dp
        if (twoPane) {
            Row(Modifier.fillMaxSize()) {
                AppsScreen(apps, project.uuid, {}, {}, {}, Modifier.width(listWidth).fillMaxHeight())
                VerticalDivider(color = DfColors.Line)
                Box(Modifier.weight(1f).fillMaxHeight()) { ProjectScreen(project, ProjectActions()) }
            }
        } else {
            AppsScreen(apps, null, {}, {}, {}, Modifier.fillMaxSize())
        }
    }
}
