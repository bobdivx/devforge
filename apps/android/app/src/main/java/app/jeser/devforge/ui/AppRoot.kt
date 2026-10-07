package app.jeser.devforge.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.jeser.devforge.AppGraph
import app.jeser.devforge.ui.apps.AppsScreen
import app.jeser.devforge.ui.apps.AppsUiState
import app.jeser.devforge.ui.apps.AppsViewModel
import app.jeser.devforge.ui.project.ProjectActions
import app.jeser.devforge.ui.project.ProjectScreen
import app.jeser.devforge.ui.project.ProjectViewModel

/**
 * Grille de tuiles (2 colonnes au téléphone, 3 à 5 sur tablette) → page de l'app en plein écran.
 * Les détails s'ouvrent dans des feuilles, jamais sous la grille.
 */
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
    Box(Modifier.fillMaxSize()) {
        if (selected == null) {
            AppsScreen(
                state = apps,
                onRefresh = { appsVm.refresh() },
                onOpen = { onSelect(it) },
                onSignOut = onSignOut,
                onNoticeShown = appsVm::noticeShown,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            BackHandler { onSelect(null) }
            ProjectRoute(graph, selected, onBack = { onSelect(null) }, onChanged = { appsVm.refresh() })
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
            onLifecycle = vm::lifecycle,
            onOpenRuntimeLogs = vm::openRuntimeLogs,
            onRefreshRuntimeLogs = vm::refreshRuntimeLogs,
            onCloseRuntimeLogs = vm::closeRuntimeLogs,
            onOpenPreview = vm::openPreview,
            onUrlOpened = vm::urlOpened,
        ),
    )
}

/** Même écran d'accueil, sans ViewModel (captures, aperçus). */
@Composable
fun HomeRootPreview(apps: AppsUiState, initialInboxOpen: Boolean = false) {
    AppsScreen(
        apps, {}, {}, {}, Modifier.fillMaxSize(),
        initialInboxOpen = initialInboxOpen,
    )
}
