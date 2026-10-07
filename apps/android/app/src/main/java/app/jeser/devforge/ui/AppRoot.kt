package app.jeser.devforge.ui

import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.jeser.devforge.AppGraph
import app.jeser.devforge.BuildConfig
import app.jeser.devforge.notify.Notifier
import app.jeser.devforge.notify.PrefsNotifSettings
import app.jeser.devforge.ui.apps.AppsScreen
import app.jeser.devforge.ui.apps.AppsUiState
import app.jeser.devforge.ui.apps.AppsViewModel
import app.jeser.devforge.ui.hub.AlertsScreen
import app.jeser.devforge.ui.hub.BraiseScreen
import app.jeser.devforge.ui.hub.HubUiState
import app.jeser.devforge.ui.hub.HubViewModel
import app.jeser.devforge.ui.hub.SettingsScreen
import app.jeser.devforge.ui.project.ProjectActions
import app.jeser.devforge.ui.project.ProjectScreen
import app.jeser.devforge.ui.project.ProjectSheet
import app.jeser.devforge.ui.project.ProjectViewModel
import app.jeser.devforge.ui.theme.DfColors

/** Onglets de la navigation principale. */
enum class HomeTab(val label: String) { Apps("Apps"), Braise("Braise"), Alerts("Alertes"), Settings("Réglages") }

private fun HomeTab.icon(): ImageVector = when (this) {
    HomeTab.Apps -> Icons.Filled.GridView
    HomeTab.Braise -> Icons.Filled.LocalFireDepartment
    HomeTab.Alerts -> Icons.Filled.Notifications
    HomeTab.Settings -> Icons.Filled.Settings
}

/**
 * Accueil : barre de navigation en bas (téléphone) ou rail (tablette) avec Apps, Braise, Alertes, Réglages.
 * La page d'une app s'ouvre en plein écran (la discussion garde toute la place).
 */
@Composable
fun HomeRoot(
    graph: AppGraph,
    selected: String?,
    onSelect: (String?) -> Unit,
    onSignOut: () -> Unit,
) {
    val context = LocalContext.current
    val uri = LocalUriHandler.current
    val appsVm: AppsViewModel = viewModel(factory = viewModelFactory { initializer { AppsViewModel(graph) } })
    val hubVm: HubViewModel = viewModel(factory = viewModelFactory {
        initializer { HubViewModel(graph, PrefsNotifSettings(context), BuildConfig.VERSION_NAME, { Notifier.canNotify(context) }) }
    })
    val apps by appsVm.state.collectAsStateWithLifecycle()
    val hub by hubVm.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(HomeTab.Apps) }
    LifecycleStartEffect(Unit) {
        appsVm.startPolling()
        hubVm.refreshConversations()
        hubVm.refreshSettings()
        onStopOrDispose { appsVm.stopPolling() }
    }
    LaunchedEffect(tab) {
        when (tab) {
            HomeTab.Apps -> Unit
            HomeTab.Braise -> hubVm.refreshConversations()
            HomeTab.Alerts -> hubVm.refreshAlerts()
            HomeTab.Settings -> hubVm.refreshSettings()
        }
    }
    var draftFor by rememberSaveable { mutableStateOf<String?>(null) }
    if (selected != null) {
        BackHandler { draftFor = null; onSelect(null) }
        ProjectRoute(
            graph, selected,
            onBack = { draftFor = null; onSelect(null) },
            onChanged = { appsVm.refresh(); hubVm.refreshConversations() },
            openDraft = draftFor == selected,
        )
        return
    }
    if (tab != HomeTab.Apps) BackHandler { tab = HomeTab.Apps }
    HomeShell(
        tab = tab,
        onTab = { tab = it },
        apps = apps,
        hub = hub,
        onRefreshApps = { appsVm.refresh() },
        onOpen = { draftFor = null; onSelect(it) },
        onOpenDraft = { draftFor = it; onSelect(it) },
        onNoticeShown = appsVm::noticeShown,
        onRefreshBraise = hubVm::refreshConversations,
        onRefreshAlerts = hubVm::refreshAlerts,
        onToggleNotif = hubVm::setNotif,
        onOpenSystemNotif = {
            runCatching {
                context.startActivity(
                    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        },
        onUpdate = { hubVm.apkUrl()?.let { runCatching { uri.openUri(it) } } },
        onOpenWeb = { hub.instance?.let { runCatching { uri.openUri(it) } } },
        onSignOut = onSignOut,
    )
}

/** Coque sans ViewModel : navigation + onglet courant (utilisée aussi par les captures). */
@Composable
fun HomeShell(
    tab: HomeTab,
    onTab: (HomeTab) -> Unit,
    apps: AppsUiState,
    hub: HubUiState,
    onRefreshApps: () -> Unit = {},
    onOpen: (String) -> Unit = {},
    onOpenDraft: (String) -> Unit = onOpen,
    onNoticeShown: () -> Unit = {},
    onRefreshBraise: () -> Unit = {},
    onRefreshAlerts: () -> Unit = {},
    onToggleNotif: (String, Boolean) -> Unit = { _, _ -> },
    onOpenSystemNotif: () -> Unit = {},
    onUpdate: () -> Unit = {},
    onOpenWeb: () -> Unit = {},
    onSignOut: () -> Unit = {},
    initialInboxOpen: Boolean = false,
) {
    val badges = mapOf(
        HomeTab.Braise to hub.waiting.size,
        HomeTab.Alerts to apps.inbox.count { it.kind != "spec_waiting" },
        HomeTab.Settings to if (hub.updateAvailable) 1 else 0,
    )
    val content: @Composable (Modifier) -> Unit = { m ->
        Box(m) {
            when (tab) {
                HomeTab.Apps -> AppsScreen(
                    state = apps, onRefresh = onRefreshApps, onOpen = onOpen,
                    modifier = Modifier.fillMaxSize(), onNoticeShown = onNoticeShown, initialInboxOpen = initialInboxOpen,
                )
                HomeTab.Braise -> BraiseScreen(hub, onRefresh = onRefreshBraise, onOpen = onOpen, onOpenDraft = onOpenDraft)
                HomeTab.Alerts -> AlertsScreen(hub, onRefresh = onRefreshAlerts, onOpen = onOpen)
                HomeTab.Settings -> SettingsScreen(
                    hub, apps.me, onToggle = onToggleNotif, onOpenSystemNotif = onOpenSystemNotif,
                    onUpdate = onUpdate, onOpenWeb = onOpenWeb, onSignOut = onSignOut,
                )
            }
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize().background(DfColors.Bg)) {
        if (maxWidth >= 600.dp) {
            Row(Modifier.fillMaxSize()) {
                NavigationRail(
                    containerColor = DfColors.Bg,
                    modifier = Modifier.fillMaxHeight().windowInsetsPadding(WindowInsets.systemBars.only(WindowInsetsSides.Vertical + WindowInsetsSides.Start)),
                ) {
                    Spacer(Modifier.height(8.dp))
                    HomeTab.entries.forEach { t ->
                        NavigationRailItem(
                            selected = t == tab,
                            onClick = { onTab(t) },
                            icon = { TabIcon(t, badges[t] ?: 0) },
                            label = { Text(t.label) },
                            colors = NavigationRailItemDefaults.colors(indicatorColor = DfColors.AccentSoft, selectedIconColor = DfColors.Accent, selectedTextColor = DfColors.Ink),
                        )
                    }
                }
                VerticalDivider(color = DfColors.Line)
                content(Modifier.weight(1f).fillMaxHeight())
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                // La barre du bas gère l'encoche de navigation : le contenu ne la réserve pas une 2e fois.
                content(Modifier.weight(1f).fillMaxWidth().consumeWindowInsets(WindowInsets.navigationBars))
                NavigationBar(containerColor = DfColors.BgElevated, tonalElevation = 0.dp) {
                    HomeTab.entries.forEach { t ->
                        NavigationBarItem(
                            selected = t == tab,
                            onClick = { onTab(t) },
                            icon = { TabIcon(t, badges[t] ?: 0) },
                            label = { Text(t.label, maxLines = 1) },
                            colors = NavigationBarItemDefaults.colors(indicatorColor = DfColors.AccentSoft, selectedIconColor = DfColors.Accent, selectedTextColor = DfColors.Ink),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TabIcon(tab: HomeTab, badge: Int) {
    BadgedBox(badge = {
        if (badge > 0) {
            Badge(containerColor = if (tab == HomeTab.Alerts) DfColors.Danger else DfColors.Accent, contentColor = DfColors.OnAccent) {
                Text(if (badge > 9) "9+" else badge.toString())
            }
        }
    }) { Icon(tab.icon(), contentDescription = null) }
}

@Composable
private fun ProjectRoute(graph: AppGraph, uuid: String, onBack: (() -> Unit)?, onChanged: () -> Unit, openDraft: Boolean = false) {
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
            onOpenDraft = vm::openDraft,
            onDraftValidate = vm::validateDraft,
            onDraftDiscard = vm::discardDraft,
            onDraftRevert = vm::revertDraftFile,
            onDraftRestore = vm::restoreDraft,
            onDraftUpdate = vm::updateDraftFromGithub,
            onDraftValidatedSeen = vm::draftValidatedSeen,
            onUndoShown = vm::undoShown,
        ),
        initialSheet = if (openDraft) ProjectSheet.Draft else ProjectSheet.None,
    )
}

/** Même écran d'accueil, sans ViewModel (captures, aperçus). */
@Composable
fun HomeRootPreview(apps: AppsUiState, initialInboxOpen: Boolean = false, tab: HomeTab = HomeTab.Apps, hub: HubUiState = HubUiState(conversationsLoading = false, alertsLoading = false)) {
    HomeShell(tab = tab, onTab = {}, apps = apps, hub = hub, initialInboxOpen = initialInboxOpen)
}
