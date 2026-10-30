package app.jeser.devforge.ui

import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
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
import app.jeser.devforge.ui.hub.BraiseScreen
import app.jeser.devforge.ui.hub.HubUiState
import app.jeser.devforge.ui.hub.HubViewModel
import app.jeser.devforge.ui.hub.SettingsScreen
import app.jeser.devforge.ui.memory.MemoryActions
import app.jeser.devforge.ui.memory.MemoryScreen
import app.jeser.devforge.ui.memory.MemoryViewModel
import app.jeser.devforge.ui.receipts.ReceiptsActions
import app.jeser.devforge.ui.receipts.ReceiptsScreen
import app.jeser.devforge.ui.receipts.ReceiptsViewModel
import app.jeser.devforge.ui.watches.WatchesActions
import app.jeser.devforge.ui.watches.WatchesScreen
import app.jeser.devforge.ui.watches.WatchesViewModel
import app.jeser.devforge.ui.project.ProjectActions
import app.jeser.devforge.ui.project.ProjectScreen
import app.jeser.devforge.ui.project.ProjectSheet
import app.jeser.devforge.ui.project.ProjectViewModel
import app.jeser.devforge.ui.theme.DfColors

/** Onglets de la navigation principale. */
/** Apps · Braise · Réglages, comme la barre du bas du web. Les alertes en cours sont la tuile « À traiter » des Apps. */
enum class HomeTab(val label: String) { Apps("Apps"), Braise("Braise"), Settings("Réglages") }

private fun HomeTab.icon(): ImageVector = when (this) {
    HomeTab.Apps -> Icons.Filled.GridView
    HomeTab.Braise -> Icons.Filled.LocalFireDepartment
    HomeTab.Settings -> Icons.Filled.Settings
}

/**
 * Accueil : barre de navigation en bas (téléphone) ou rail (tablette) avec Apps, Braise, Réglages.
 * La page d'une app et la mémoire s'ouvrent au-dessus de l'onglet, la navigation reste visible.
 */
@Composable
fun HomeRoot(
    graph: AppGraph,
    selected: String?,
    onSelect: (String?) -> Unit,
    onSignOut: () -> Unit,
    openCorrectionsFor: String? = null,
    onCorrectionsOpened: () -> Unit = {},
    openWatches: Boolean = false,
    onWatchesOpened: () -> Unit = {},
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
            HomeTab.Settings -> hubVm.refreshSettings()
        }
    }
    var draftFor by rememberSaveable { mutableStateOf<String?>(null) }
    // Notification « correction » : ouvre directement la feuille Corrections de l'app.
    LaunchedEffect(openCorrectionsFor) {
        openCorrectionsFor?.let { draftFor = it; onSelect(it); onCorrectionsOpened() }
    }
    var memoryOpen by rememberSaveable { mutableStateOf(false) }
    var receiptsOpen by rememberSaveable { mutableStateOf(false) }
    var watchesOpen by rememberSaveable { mutableStateOf(false) }
    // Notification « surveillance » : ouvre la liste des pages surveillées.
    LaunchedEffect(openWatches) {
        if (openWatches) { draftFor = null; onSelect(null); watchesOpen = true; onWatchesOpened() }
    }
    // Écran plein (app, mémoire) : la barre Apps / Braise / Réglages reste visible dessous.
    val screen: (@Composable (Modifier) -> Unit)? = when {
        selected != null -> { m ->
            BackHandler { draftFor = null; onSelect(null) }
            Box(m) {
                ProjectRoute(
                    graph, selected,
                    onBack = { draftFor = null; onSelect(null) },
                    onChanged = { appsVm.refresh(); hubVm.refreshConversations() },
                    openDraft = draftFor == selected,
                )
            }
        }
        memoryOpen -> { m ->
            BackHandler { memoryOpen = false }
            Box(m) { MemoryRoute(graph, onBack = { memoryOpen = false }) }
        }
        receiptsOpen -> { m ->
            BackHandler { receiptsOpen = false }
            Box(m) { ReceiptsRoute(graph, onBack = { receiptsOpen = false }) }
        }
        watchesOpen -> { m ->
            BackHandler { watchesOpen = false }
            Box(m) { WatchesRoute(graph, onBack = { watchesOpen = false }) }
        }
        else -> null
    }
    if (screen == null && tab != HomeTab.Apps) BackHandler { tab = HomeTab.Apps }
    HomeShell(
        tab = tab,
        onTab = {
            // Toucher un onglet depuis une app / la mémoire : on ferme l'écran et on va sur l'onglet.
            draftFor = null
            memoryOpen = false
            receiptsOpen = false
            watchesOpen = false
            if (selected != null) onSelect(null)
            tab = it
        },
        screen = screen,
        apps = apps,
        hub = hub,
        onRefreshApps = { appsVm.refresh() },
        onOpen = { draftFor = null; if (it.isBlank()) watchesOpen = true else onSelect(it) },
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
        onOpenMemory = { memoryOpen = true },
        onOpenReceipts = { receiptsOpen = true },
        onOpenWatches = { watchesOpen = true },
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
    onOpenMemory: () -> Unit = {},
    onOpenReceipts: () -> Unit = {},
    onOpenWatches: () -> Unit = {},
    onSignOut: () -> Unit = {},
    initialInboxOpen: Boolean = false,
    /** Écran ouvert par-dessus l'onglet (page d'app, mémoire…) ; la navigation reste visible. */
    screen: (@Composable (Modifier) -> Unit)? = null,
) {
    val badges = mapOf(
        HomeTab.Braise to hub.waiting.size,
        HomeTab.Settings to if (hub.updateAvailable) 1 else 0,
    )
    val content: @Composable (Modifier) -> Unit = screen ?: { m ->
        Box(m) {
            when (tab) {
                HomeTab.Apps -> AppsScreen(
                    state = apps, onRefresh = onRefreshApps, onOpen = onOpen,
                    modifier = Modifier.fillMaxSize(), onNoticeShown = onNoticeShown, initialInboxOpen = initialInboxOpen,
                )
                HomeTab.Braise -> BraiseScreen(hub, onRefresh = onRefreshBraise, onOpen = onOpen, onOpenDraft = onOpenDraft)
                HomeTab.Settings -> SettingsScreen(
                    hub, apps.me, onToggle = onToggleNotif, onOpenSystemNotif = onOpenSystemNotif,
                    onUpdate = onUpdate, onOpenWeb = onOpenWeb, onOpenMemory = onOpenMemory, onOpenReceipts = onOpenReceipts, onOpenWatches = onOpenWatches, onSignOut = onSignOut,
                )
            }
        }
    }
    MainNavFrame(tab = tab, onTab = onTab, badges = badges, content = content)
}

/**
 * Navigation principale toujours visible : barre du bas (téléphone) ou rail (tablette).
 * Sur téléphone, la barre se replie seulement quand le clavier est ouvert (la saisie reste visible).
 */
@Composable
fun MainNavFrame(
    tab: HomeTab,
    onTab: (HomeTab) -> Unit,
    badges: Map<HomeTab, Int> = emptyMap(),
    content: @Composable (Modifier) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize().background(DfColors.Bg)) {
        if (maxWidth >= 600.dp) {
            Row(Modifier.fillMaxSize()) {
                NavigationRail(
                    containerColor = DfColors.Bg,
                    modifier = Modifier.fillMaxHeight().testTag("main-nav")
                        .windowInsetsPadding(WindowInsets.systemBars.only(WindowInsetsSides.Vertical + WindowInsetsSides.Start)),
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
                // Le rail gère le bord gauche : le contenu ne le réserve pas une 2e fois.
                content(Modifier.weight(1f).fillMaxHeight().consumeWindowInsets(WindowInsets.systemBars.only(WindowInsetsSides.Start)))
            }
        } else {
            // Hauteur réelle du clavier (isImeVisible vaut vrai tant qu'aucun inset n'est reçu).
            val imeOpen = WindowInsets.ime.getBottom(LocalDensity.current) > 0
            Column(Modifier.fillMaxSize()) {
                // La barre du bas gère l'encoche de navigation : le contenu ne la réserve pas une 2e fois.
                content(
                    Modifier.weight(1f).fillMaxWidth()
                        .then(if (imeOpen) Modifier else Modifier.consumeWindowInsets(WindowInsets.navigationBars)),
                )
                if (!imeOpen) {
                    NavigationBar(containerColor = DfColors.BgElevated, tonalElevation = 0.dp, modifier = Modifier.testTag("main-nav")) {
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
}

@Composable
private fun TabIcon(tab: HomeTab, badge: Int) {
    BadgedBox(badge = {
        if (badge > 0) {
            Badge(containerColor = DfColors.Accent, contentColor = DfColors.OnAccent) {
                Text(if (badge > 9) "9+" else badge.toString())
            }
        }
    }) { Icon(tab.icon(), contentDescription = null) }
}

/** Réglages → Mémoire : écran natif (plus de page web). */
@Composable
private fun MemoryRoute(graph: AppGraph, onBack: () -> Unit) {
    val vm: MemoryViewModel = viewModel(key = "memory", factory = viewModelFactory { initializer { MemoryViewModel(graph) } })
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.load() }
    MemoryScreen(
        state = state,
        actions = MemoryActions(
            onBack = onBack,
            onTab = vm::load,
            onRetry = { vm.load() },
            onCorrect = vm::correct,
            onForget = vm::forget,
            onPin = vm::pin,
            onNoticeShown = vm::noticeShown,
        ),
    )
}

/** Réglages → Validations : reçus d'approbation (lecture seule). */
@Composable
private fun ReceiptsRoute(graph: AppGraph, onBack: () -> Unit) {
    val vm: ReceiptsViewModel = viewModel(key = "receipts", factory = viewModelFactory { initializer { ReceiptsViewModel(graph) } })
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.load() }
    ReceiptsScreen(
        state = state,
        actions = ReceiptsActions(
            onBack = onBack,
            onFilter = vm::load,
            onRetry = { vm.load() },
            onMore = vm::more,
            loadDetail = vm::fresh,
        ),
    )
}

/** Réglages → Surveillance : pages surveillées (liste + détail + actions). */
@Composable
private fun WatchesRoute(graph: AppGraph, onBack: () -> Unit) {
    val vm: WatchesViewModel = viewModel(key = "watches", factory = viewModelFactory { initializer { WatchesViewModel(graph) } })
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.load() }
    WatchesScreen(
        state = state,
        actions = WatchesActions(
            onBack = onBack,
            onRetry = vm::load,
            onOpen = vm::open,
            onClose = vm::close,
            onRun = vm::runNow,
            onPause = vm::pause,
            onResume = vm::resume,
            onAskDelete = vm::askDelete,
            onCancelDelete = vm::cancelDelete,
            onDelete = vm::delete,
        ),
    )
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
            onSend = { vm.send(it) },
            onCancelJob = vm::cancelJob,
            onControlJob = vm::controlJob,
            onAnswer = { item, option, text -> vm.answer(item, option, text) },
            onReact = { item, emoji -> vm.react(item, emoji) },
            onAttachImage = { bytes, mime, name -> vm.attachImage(bytes, mime, name) },
            onRemoveImage = vm::removeImage,
            attachmentUrl = { id -> graph.api.attachmentUrl(id) },
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
            onOpenCorrections = vm::openCorrections,
            onOpenPlaybooks = vm::openPlaybooks,
            onClosePlaybooks = vm::closePlaybooks,
            onRunPlaybook = vm::runPlaybook,
            onWakeGrok = vm::wakeGrok,
            onApplyCorrection = vm::applyCorrection,
            onRejectCorrection = vm::rejectCorrection,
            onRedoCorrection = vm::redoCorrection,
            onRestoreCorrection = vm::restoreCorrection,
            onDraftValidate = vm::validateDraft,
            onDraftDiscard = vm::discardDraft,
            onDraftRevert = vm::revertDraftFile,
            onDraftRestore = vm::restoreDraft,
            onDraftUpdate = vm::updateDraftFromGithub,
            onDraftValidatedSeen = vm::draftValidatedSeen,
            onUndoShown = vm::undoShown,
        ),
        initialSheet = if (openDraft) ProjectSheet.Corrections else ProjectSheet.None,
    )
}

/** Même écran d'accueil, sans ViewModel (captures, aperçus). */
@Composable
fun HomeRootPreview(apps: AppsUiState, initialInboxOpen: Boolean = false, tab: HomeTab = HomeTab.Apps, hub: HubUiState = HubUiState(conversationsLoading = false, alertsLoading = false)) {
    HomeShell(tab = tab, onTab = {}, apps = apps, hub = hub, initialInboxOpen = initialInboxOpen)
}
