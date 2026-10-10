package app.jeser.devforge.ui.project

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.Subject
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.AppStatus
import app.jeser.devforge.data.DeployPlan
import app.jeser.devforge.data.Deployment
import app.jeser.devforge.data.SpecFeature
import app.jeser.devforge.ui.apps.hostOf
import app.jeser.devforge.ui.components.AppIcon
import app.jeser.devforge.ui.components.ConfirmActionSheet
import app.jeser.devforge.ui.components.Persona
import app.jeser.devforge.ui.components.PersonaAvatar
import app.jeser.devforge.ui.components.PersonaMessage
import app.jeser.devforge.ui.components.TileBg
import app.jeser.devforge.ui.components.color
import app.jeser.devforge.ui.components.relativeTime
import app.jeser.devforge.ui.components.restartConfirm
import app.jeser.devforge.ui.components.stopConfirm
import app.jeser.devforge.ui.markdown.MarkdownText
import app.jeser.devforge.ui.theme.DfColors

data class ProjectActions(
    val onBack: (() -> Unit)? = null,
    val onRetry: () -> Unit = {},
    val onSend: (String) -> Unit = {},
    val onDeploy: (String) -> Unit = {},
    val onOpenLogs: (Deployment) -> Unit = {},
    val onCloseLogs: () -> Unit = {},
    val onOpenSpec: (SpecFeature) -> Unit = {},
    val onCloseSpec: () -> Unit = {},
    val onDecideSpec: (Boolean) -> Unit = {},
    val onCreateSpec: (String, String, () -> Unit) -> Unit = { _, _, _ -> },
    val onNoticeShown: () -> Unit = {},
    val onLifecycle: (String) -> Unit = {},
    val onOpenRuntimeLogs: () -> Unit = {},
    val onRefreshRuntimeLogs: () -> Unit = {},
    val onCloseRuntimeLogs: () -> Unit = {},
    val onOpenPreview: () -> Unit = {},
    val onUrlOpened: () -> Unit = {},
    val onOpenDraft: () -> Unit = {},
    val onDraftValidate: (String) -> Unit = {},
    val onDraftDiscard: (() -> Unit) -> Unit = {},
    val onDraftRevert: (String, () -> Unit) -> Unit = { _, _ -> },
    val onDraftRestore: (String) -> Unit = {},
    val onDraftUpdate: () -> Unit = {},
    val onDraftValidatedSeen: () -> Unit = {},
    val onUndoShown: () -> Unit = {},
)

/** Feuilles de la page app (une seule ouverte à la fois). */
enum class ProjectSheet { None, Details, More, Deploys, Stop, Restart, Deploy, NewFeature, Draft, DraftFile, DraftValidate, DraftDiscard, Chat }

private data class Chip(val key: String, val label: String, val danger: Boolean = false)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ProjectScreen(
    state: ProjectUiState,
    actions: ProjectActions,
    modifier: Modifier = Modifier,
    initialSheet: ProjectSheet = ProjectSheet.None,
    initialDraftPath: String? = null,
) {
    var sheet by rememberSaveable { mutableStateOf(initialSheet) }
    var draftPath by rememberSaveable { mutableStateOf<String?>(initialDraftPath) }
    LaunchedEffect(Unit) { if (initialSheet == ProjectSheet.Draft) actions.onOpenDraft() }
    var input by rememberSaveable { mutableStateOf("") }
    val snackbar = remember { SnackbarHostState() }
    val uri = LocalUriHandler.current

    LaunchedEffect(state.notice) {
        state.notice?.let {
            snackbar.showSnackbar(it)
            actions.onNoticeShown()
        }
    }
    LaunchedEffect(state.undo) {
        state.undo?.let { u ->
            val r = snackbar.showSnackbar(u.message, actionLabel = "Annuler", duration = SnackbarDuration.Long)
            if (r == SnackbarResult.ActionPerformed) actions.onDraftRestore(u.backupId)
            actions.onUndoShown()
        }
    }
    LaunchedEffect(state.openUrl) {
        state.openUrl?.let { runCatching { uri.openUri(it) }; actions.onUrlOpened() }
    }

    val project = state.project
    val onSheet: (ProjectSheet) -> Unit = { sheet = it }
    val openDraft = { actions.onOpenDraft(); sheet = ProjectSheet.Draft }
    Scaffold(
        modifier = modifier,
        containerColor = DfColors.Bg,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {
                    if (project != null) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            // Petit écran : on garde la place pour le nom et les actions.
                            if (LocalConfiguration.current.screenWidthDp >= 400) {
                                AppIcon(project.name, project.productionUrl, project.gitRepository, status = null, size = 28.dp)
                                Spacer(Modifier.width(8.dp))
                            }
                            Text(project.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                },
                navigationIcon = {
                    actions.onBack?.let { back ->
                        IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour aux apps") }
                    }
                },
                actions = { if (project != null) TopActions(state, actions, onSheet) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DfColors.Bg),
            )
        },
    ) { padding ->
        Box(
            Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).imePadding(),
        ) {
            when {
                state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = DfColors.Accent)
                }
                project == null -> PersonaMessage(
                    Persona.Phare,
                    "Impossible d'ouvrir cette app",
                    state.error ?: "Réessaie dans un instant.",
                    action = "Réessayer",
                    onAction = actions.onRetry,
                    modifier = Modifier.align(Alignment.Center),
                )
                else -> BoxWithConstraints(Modifier.fillMaxSize()) {
                    val wide = maxWidth >= 900.dp
                    if (wide) {
                        Row(Modifier.fillMaxSize()) {
                            Column(
                                Modifier.width(380.dp).fillMaxHeight().verticalScroll(rememberScrollState())
                                    .padding(start = 20.dp, end = 16.dp, bottom = 16.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                StatusStrip(state, onClick = { sheet = ProjectSheet.Details })
                                DeployBanner(state, onDeploy = { sheet = ProjectSheet.Deploy }, onLogs = { state.latest?.let(actions.onOpenLogs) ?: actions.onOpenRuntimeLogs() })
                                DraftBanner(state.draft, onClick = openDraft)
                                RecentDeploys(state, onOpen = actions.onOpenLogs)
                            }
                            VerticalDivider(color = DfColors.Line)
                            ChatPane(state, input, { input = it }, actions, onNewFeature = { sheet = ProjectSheet.NewFeature }, modifier = Modifier.weight(1f))
                        }
                    } else {
                        // Mobile : Overview en tuiles + chat ouvrable.
                        val side = if (maxWidth >= 600.dp) 24.dp else 12.dp
                        Box(Modifier.fillMaxSize()) {
                            Column(
                                Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                                    .padding(horizontal = side).padding(bottom = 80.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                StatusStrip(state, onClick = { sheet = ProjectSheet.Details })
                                // Tuiles d'action
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TileButton("Chat", onClick = { sheet = ProjectSheet.Chat }, modifier = Modifier.weight(1f))
                                    TileButton("Agents", onClick = { sheet = ProjectSheet.More }, modifier = Modifier.weight(1f))
                                }
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TileButton("Nouveau brouillon", onClick = { sheet = ProjectSheet.NewFeature }, modifier = Modifier.weight(1f))
                                    TileButton("Déploiements", onClick = { sheet = ProjectSheet.Deploys }, modifier = Modifier.weight(1f))
                                }
                                DeployBanner(state, onDeploy = { sheet = ProjectSheet.Deploy }, onLogs = { state.latest?.let(actions.onOpenLogs) ?: actions.onOpenRuntimeLogs() })
                                DraftBanner(state.draft, onClick = openDraft)
                                RecentDeploys(state, onOpen = actions.onOpenLogs)
                            }
                            FloatingActionButton(
                                onClick = { sheet = ProjectSheet.Chat },
                                modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
                                containerColor = DfColors.Accent,
                            ) {
                                Icon(Icons.AutoMirrored.Filled.Subject, contentDescription = "Discuter")
                            }
                        }
                    }
                }
            }
        }
    }

    if (project != null) {
        val close = { sheet = ProjectSheet.None }
        when (sheet) {
            ProjectSheet.Details -> DetailsSheet(
                state,
                onDismiss = close,
                onOpenLogs = { d -> sheet = ProjectSheet.None; actions.onOpenLogs(d) },
                onHistory = { sheet = ProjectSheet.Deploys },
            )
            ProjectSheet.More -> MoreSheet(state, actions, onDismiss = close, onSheet = onSheet)
            ProjectSheet.Deploys -> DeploysSheet(state, onDismiss = close, onOpen = { d -> sheet = ProjectSheet.None; actions.onOpenLogs(d) })
            ProjectSheet.Stop -> ConfirmActionSheet(
                stopConfirm(project.name, hostOf(project.productionUrl)),
                busy = state.lifecycleBusy == "stop",
                onDismiss = close,
                onConfirm = { actions.onLifecycle("stop"); sheet = ProjectSheet.None },
            )
            ProjectSheet.Restart -> ConfirmActionSheet(
                restartConfirm(project.name),
                busy = state.lifecycleBusy == "restart",
                onDismiss = close,
                onConfirm = { actions.onLifecycle("restart"); sheet = ProjectSheet.None },
            )
            ProjectSheet.Deploy -> DeployConfirmSheet(
                project = project,
                plan = state.deployPlan,
                failure = state.latest?.takeIf { it.isFailed }?.errorSummary,
                busy = state.deploying,
                onDismiss = close,
                onConfirm = { msg -> actions.onDeploy(msg); sheet = ProjectSheet.None },
            )
            ProjectSheet.NewFeature -> NewFeatureSheet(
                busy = state.creatingSpec,
                onDismiss = close,
                onSubmit = { t, d -> actions.onCreateSpec(t, d) { sheet = ProjectSheet.None } },
            )
            ProjectSheet.Draft -> DraftSheet(
                state,
                onDismiss = close,
                onOpenFile = { p -> draftPath = p; sheet = ProjectSheet.DraftFile },
                onValidate = { actions.onDraftValidatedSeen(); sheet = ProjectSheet.DraftValidate },
                onDiscard = { sheet = ProjectSheet.DraftDiscard },
                onUpdate = actions.onDraftUpdate,
                onRestore = actions.onDraftRestore,
                onOpenPreview = { actions.onOpenPreview(); close() },
            )
            ProjectSheet.DraftFile -> DraftFileSheet(
                state,
                path = draftPath.orEmpty(),
                onBack = { sheet = ProjectSheet.Draft },
                onDismiss = close,
                onRevert = { p -> actions.onDraftRevert(p) { sheet = ProjectSheet.Draft } },
            )
            ProjectSheet.DraftValidate -> DraftValidateSheet(
                state,
                canDeploy = state.canDeploy,
                onDismiss = { actions.onDraftValidatedSeen(); close() },
                onValidate = actions.onDraftValidate,
                onDeployNow = {
                    actions.onDeploy("Mise en ligne après validation du brouillon")
                    actions.onDraftValidatedSeen()
                    close()
                },
            )
            ProjectSheet.DraftDiscard -> DraftDiscardSheet(
                state,
                onDismiss = { sheet = ProjectSheet.Draft },
                onConfirm = { actions.onDraftDiscard { sheet = ProjectSheet.None } },
            )
            ProjectSheet.Chat -> ModalBottomSheet(
                onDismissRequest = close,
                sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            ) {
                ChatPane(
                    state, input, { input = it }, actions,
                    onNewFeature = { sheet = ProjectSheet.NewFeature },
                    modifier = Modifier.fillMaxHeight(0.9f).padding(16.dp),
                )
            }
            ProjectSheet.None -> Unit
        }
    }
    val askRepair = {
        actions.onCloseRuntimeLogs(); actions.onCloseLogs(); actions.onSend(ChipText.REPAIR)
    }
    if (state.runtimeLogs != null) {
        RuntimeLogsSheet(state, onDismiss = actions.onCloseRuntimeLogs, onRefresh = actions.onRefreshRuntimeLogs, onAskRepair = askRepair)
    } else {
        state.logs?.let { LogsSheet(it, onDismiss = actions.onCloseLogs, onAskRepair = askRepair) }
    }
    state.spec?.let { SpecSheet(it, onDismiss = actions.onCloseSpec, onDecide = actions.onDecideSpec) }
}

@Composable
private fun TileButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        onClick = onClick,
        color = TileBg,
        shape = RoundedCornerShape(14.dp),
        modifier = modifier.height(72.dp),
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(label, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = DfColors.Ink)
        }
    }
}

/* ---------------- Bande d'état ---------------- */

/** « ● En ligne · 25 h · Santé OK · jeser.app › » : un toucher ouvre tout le détail. */
@Composable
fun StatusStrip(state: ProjectUiState, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val project = state.project ?: return
    val s = state.summary
    val latest = state.latest
    val host = hostOf(project.productionUrl)
    val alert = s.status in setOf(AppStatus.Failed, AppStatus.Down) || latest?.isFailed == true
    val text = buildAnnotatedString {
        withStyle(SpanStyle(color = s.status.color(), fontWeight = FontWeight.SemiBold)) { append(s.status.label) }
        val parts = buildList<Pair<String, Color>> {
            s.since?.let { add(it.removePrefix("depuis ") to DfColors.InkMuted) }
            when {
                latest?.isRunning == true -> add("mise en ligne en cours" to DfColors.Warn)
                latest?.isFailed == true -> add("mise en ligne échouée" to DfColors.Danger)
            }
            when (s.healthOk) {
                true -> add("Santé OK" to DfColors.InkMuted)
                false -> add("ne répond pas" to DfColors.Danger)
                null -> Unit
            }
            add((host ?: "brouillon local") to DfColors.InkFaint)
        }
        parts.forEach { (t, c) ->
            withStyle(SpanStyle(color = DfColors.InkFaint)) { append(" · ") }
            withStyle(SpanStyle(color = c)) { append(t) }
        }
    }
    Surface(
        onClick = onClick,
        color = TileBg,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, if (alert) DfColors.Danger.copy(alpha = .35f) else Color.Transparent),
        modifier = modifier.fillMaxWidth().heightIn(min = 48.dp).semantics {
            contentDescription = "État de l'app : ${text.text}. Toucher pour le détail."
            role = Role.Button
        },
    ) {
        Row(Modifier.padding(start = 14.dp, end = 8.dp, top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(s.status.color(), CircleShape))
            Spacer(Modifier.width(8.dp))
            Text(text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Icon(Icons.Filled.ExpandMore, contentDescription = null, tint = DfColors.InkFaint, modifier = Modifier.padding(start = 4.dp).size(20.dp))
        }
    }
}

/* ---------------- Bandeau de mise en ligne ---------------- */

/**
 * N'apparaît que s'il y a quelque chose à faire : changements à publier, échec à réessayer,
 * première publication, ou mise en ligne en cours. App à jour → rien (« Reconstruire » est dans « Plus »).
 */
@Composable
fun DeployBanner(state: ProjectUiState, onDeploy: () -> Unit, onLogs: () -> Unit) {
    val plan = state.deployPlan
    if (!plan.primary && plan.kind != DeployPlan.Kind.InProgress) return
    val tone = when (plan.kind) {
        DeployPlan.Kind.Retry -> DfColors.Danger
        DeployPlan.Kind.InProgress -> DfColors.Warn
        else -> DfColors.Accent
    }
    Surface(
        color = tone.copy(alpha = .08f),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, tone.copy(alpha = .3f)),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(start = 12.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            if (plan.kind == DeployPlan.Kind.InProgress) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = tone)
            } else {
                Icon(
                    if (plan.kind == DeployPlan.Kind.Retry) Icons.Filled.Refresh else Icons.Filled.CloudUpload,
                    contentDescription = null, tint = tone, modifier = Modifier.size(20.dp),
                )
            }
            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                Text(plan.label, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(plan.summary, color = DfColors.InkMuted, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (plan.kind == DeployPlan.Kind.InProgress) {
                TextButton(onClick = onLogs, modifier = Modifier.heightIn(min = 48.dp)) { Text("Logs") }
            } else {
                Button(
                    onClick = onDeploy,
                    enabled = state.canDeploy,
                    colors = ButtonDefaults.buttonColors(containerColor = tone, contentColor = if (plan.kind == DeployPlan.Kind.Retry) Color.White else DfColors.OnAccent),
                    contentPadding = PaddingValues(horizontal = 14.dp),
                    modifier = Modifier.heightIn(min = 40.dp),
                ) { Text(plan.shortLabel, fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

/* ---------------- Actions ---------------- */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TopAction(
    icon: ImageVector,
    tooltip: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    busy: Boolean = false,
    filled: Boolean = false,
) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(tooltip) } },
        state = rememberTooltipState(),
    ) {
        val content: @Composable () -> Unit = {
            if (busy) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = if (filled) DfColors.OnAccent else DfColors.Accent)
            } else {
                Icon(icon, contentDescription = tooltip, modifier = Modifier.size(22.dp))
            }
        }
        if (filled) {
            FilledIconButton(
                onClick = onClick,
                enabled = enabled && !busy,
                shape = RoundedCornerShape(14.dp),
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = DfColors.Accent, contentColor = DfColors.OnAccent),
                modifier = Modifier.size(48.dp).padding(4.dp),
                content = content,
            )
        } else {
            IconButton(onClick = onClick, enabled = enabled && !busy, modifier = Modifier.size(48.dp), content = content)
        }
    }
}

/** Barre du haut : Ouvrir, Logs et « Plus » (aperçu, redémarrer, arrêter, reconstruire…). La publication vit dans le bandeau. */
@Composable
private fun TopActions(state: ProjectUiState, actions: ProjectActions, onSheet: (ProjectSheet) -> Unit) {
    val project = state.project ?: return
    val uri = LocalUriHandler.current
    val url = project.productionUrl?.split(',')?.firstOrNull()?.trim()
    TopAction(
        Icons.AutoMirrored.Filled.OpenInNew, "Ouvrir le site en ligne",
        onClick = { url?.let { runCatching { uri.openUri(if (it.startsWith("http")) it else "https://$it") } } },
        enabled = !url.isNullOrBlank(),
    )
    TopAction(Icons.AutoMirrored.Filled.Subject, "Logs de l'app et de la dernière mise en ligne", onClick = actions.onOpenRuntimeLogs)
    TopAction(
        Icons.Filled.MoreVert, "Plus : aperçu, redémarrer, arrêter, détails",
        onClick = { onSheet(ProjectSheet.More) },
        busy = state.lifecycleBusy != null || state.previewStarting,
    )
}

@Composable
private fun RecentDeploys(state: ProjectUiState, onOpen: (Deployment) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Dernières mises en ligne", style = MaterialTheme.typography.titleSmall, color = DfColors.InkMuted)
        if (state.deployments.isEmpty()) {
            Text("Pas encore de mise en ligne. Le brouillon reste local.", color = DfColors.InkFaint, style = MaterialTheme.typography.bodyMedium)
        }
        state.deployments.take(6).forEach { d -> DeployRow(d, onClick = { onOpen(d) }) }
    }
}

@Composable
private fun ChatPane(
    state: ProjectUiState,
    input: String,
    onInput: (String) -> Unit,
    actions: ProjectActions,
    onNewFeature: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val listState = rememberLazyListState()
    // « Collé en bas » : mis à jour seulement par les défilements (utilisateur ou programme), pas par l'arrivée de contenu.
    var stick by remember { mutableStateOf(true) }
    LaunchedEffect(listState) {
        var wasScrolling = false
        snapshotFlow {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()
            val atBottom = last == null ||
                (last.index >= info.totalItemsCount - 1 && last.offset + last.size <= info.viewportEndOffset + 120)
            listState.isScrollInProgress to atBottom
        }.collect { (scrolling, atBottom) ->
            if (scrolling || wasScrolling) stick = atBottom
            wasScrolling = scrolling
        }
    }
    val lastItem = state.messages.lastOrNull()
    val signature = "${state.messages.size}|${lastItem?.key}|${lastItem?.content?.length}|${state.sending}|${state.waitingSpecs.size}"
    var lastSent by remember { mutableIntStateOf(state.sentCounter) }
    LaunchedEffect(signature, state.sentCounter) {
        val justSent = state.sentCounter != lastSent
        lastSent = state.sentCounter
        // Nombre d'éléments calculé depuis les données (la mise en page peut ne pas être encore faite).
        val count = (if (state.messages.isEmpty() && !state.sending) 1 else 0) +
            state.messages.size + (if (state.sending) 1 else 0) + state.waitingSpecs.size + 1
        if (stick || justSent) {
            listState.scrollToItem(count - 1)
            stick = true
        }
    }

    // Clavier ouvert / rotation : la zone visible rétrécit ; on garde le bas du fil visible si on y était.
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.viewportSize.height }.collect {
            val count = listState.layoutInfo.totalItemsCount
            if (stick && count > 0) listState.scrollToItem(count - 1)
        }
    }

    val chips = buildList {
        if (state.lastFailed) add(Chip("repair", "🩹 Réparer", danger = true))
        add(Chip("feature", "✨ Nouveauté"))
        add(Chip("health", "🩺 Ça va ?"))
        add(Chip("design", "🎨 Design"))
    }
    val canChat = state.coordinatorUuid != null && !state.sending
    val lastPlanKey = state.messages.lastOrNull { it.hasPlan }?.key
        ?.takeIf { key -> state.messages.lastOrNull { it.role == "assistant" }?.key == key }

    Column(modifier.fillMaxWidth()) {
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth().testTag("chat"),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (state.messages.isEmpty() && !state.sending) {
                item(key = "empty") {
                    PersonaMessage(
                        Persona.Braise,
                        "Braise 🔥 est prête",
                        "Décris ce que tu veux changer. Elle construit en brouillon ; rien n'est publié sans ton feu vert.",
                    )
                }
            }
            items(state.messages, key = { it.key }) { m ->
                MessageRow(m, showPlanAction = m.key == lastPlanKey && canChat, onBuild = { actions.onSend(ChipText.BUILD_PLAN) })
            }
            if (state.sending) {
                item(key = "thinking") { ThinkingRow(state.progress) }
            }
            items(state.waitingSpecs, key = { "spec:" + it.slug }) { f ->
                SpecWaitingCard(f, onOpen = { actions.onOpenSpec(f) })
            }
            item(key = "bottom") { Spacer(Modifier.height(1.dp)) }
        }
        val chipsState = rememberLazyListState()
        LazyRow(
            state = chipsState,
            contentPadding = PaddingValues(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            // Fondu sur les bords quand il reste des suggestions à faire défiler : rien n'a l'air coupé.
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp)
                .fadingEdges(start = chipsState.canScrollBackward, end = chipsState.canScrollForward),
        ) {
            items(chips, key = { it.key }) { chip ->
                val c = if (chip.danger) DfColors.Danger else DfColors.Ink
                Surface(
                    onClick = {
                        when (chip.key) {
                            "feature" -> onNewFeature()
                            "health" -> actions.onSend(ChipText.HEALTH)
                            "design" -> actions.onSend(ChipText.DESIGN)
                            "repair" -> actions.onSend(ChipText.REPAIR)
                        }
                    },
                    enabled = canChat,
                    shape = RoundedCornerShape(50),
                    color = if (chip.danger) DfColors.Danger.copy(alpha = .1f) else DfColors.Surface,
                    border = BorderStroke(1.dp, if (chip.danger) DfColors.Danger.copy(alpha = .35f) else DfColors.LineStrong),
                ) {
                    // 40 dp visibles ; la zone tactile reste à 48 dp (minimumInteractiveComponentSize).
                    Box(Modifier.padding(horizontal = 14.dp).heightIn(min = 40.dp), contentAlignment = Alignment.Center) {
                        Text(chip.label, color = if (canChat) c else c.copy(alpha = .4f), fontSize = 14.sp)
                    }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 10.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = onInput,
                placeholder = { Text("Écris à Braise…", maxLines = 1) },
                enabled = state.coordinatorUuid != null,
                maxLines = 5,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                shape = RoundedCornerShape(16.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = DfColors.Accent,
                    unfocusedBorderColor = DfColors.LineStrong,
                    focusedContainerColor = DfColors.Surface,
                    unfocusedContainerColor = DfColors.Surface,
                    disabledContainerColor = DfColors.Surface,
                ),
                modifier = Modifier.weight(1f).heightIn(min = 52.dp),
            )
            FilledIconButton(
                onClick = {
                    actions.onSend(input)
                    onInput("")
                },
                enabled = canChat && input.isNotBlank(),
                modifier = Modifier.size(52.dp),
                shape = RoundedCornerShape(16.dp),
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = DfColors.Accent, contentColor = DfColors.OnAccent),
            ) {
                if (state.sending) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = DfColors.Ink)
                } else {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Envoyer")
                }
            }
        }
    }
}

@Composable
private fun MessageRow(m: ChatItem, showPlanAction: Boolean, onBuild: () -> Unit) {
    when (m.role) {
        "user" -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
            Surface(
                color = DfColors.AccentSoft,
                shape = RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp),
                border = BorderStroke(1.dp, DfColors.Accent.copy(alpha = .25f)),
                modifier = Modifier.widthIn(max = 560.dp).padding(start = 48.dp),
            ) {
                SelectionContainer {
                    Text(m.content, modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp), fontSize = 15.sp, lineHeight = 21.sp)
                }
            }
        }
        "assistant" -> Row(Modifier.fillMaxWidth()) {
            PersonaAvatar(Persona.Braise, 30.dp, Modifier.padding(top = 2.dp))
            Column(Modifier.padding(start = 10.dp).weight(1f, fill = false).widthIn(max = 640.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Surface(
                    color = DfColors.Card,
                    shape = RoundedCornerShape(4.dp, 18.dp, 18.dp, 18.dp),
                    border = BorderStroke(1.dp, DfColors.Line),
                ) {
                    SelectionContainer {
                        MarkdownText(m.content.ifBlank { "…" }, Modifier.padding(horizontal = 14.dp, vertical = 10.dp))
                    }
                }
                if (showPlanAction) {
                    OutlinedButton(onClick = onBuild, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text("🧱 Construire en brouillon")
                    }
                    Text("En local seulement. Rien n'est mis en ligne.", color = DfColors.InkFaint, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        else -> Text(
            m.content,
            color = DfColors.InkFaint,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp),
        )
    }
}

@Composable
private fun ThinkingRow(progress: String?) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        PersonaAvatar(Persona.Braise, 30.dp)
        Surface(color = DfColors.Card, shape = RoundedCornerShape(18.dp), border = BorderStroke(1.dp, DfColors.Line), modifier = Modifier.padding(start = 10.dp)) {
            Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = DfColors.Accent)
                Spacer(Modifier.width(10.dp))
                Text(progress ?: "Braise réfléchit…", color = DfColors.InkMuted, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun SpecWaitingCard(f: SpecFeature, onOpen: () -> Unit) {
    Surface(
        color = DfColors.AccentSoft,
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, DfColors.Accent.copy(alpha = .4f)),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            PersonaAvatar(Persona.Braise, 40.dp)
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text("Braise attend ton OK", fontWeight = FontWeight.SemiBold)
                Text("« ${f.title} »", color = DfColors.InkMuted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Button(onClick = onOpen, modifier = Modifier.heightIn(min = 48.dp)) { Text("Relire") }
        }
    }
}

@Composable
fun DeployRow(d: Deployment, onClick: () -> Unit) {
    val (label, color) = deployLabel(d)
    Surface(
        onClick = onClick,
        color = DfColors.Card,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, if (d.isFailed) DfColors.Danger.copy(alpha = .35f) else DfColors.Line),
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(9.dp).background(color, CircleShape))
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(
                    d.gitMessage?.lineSequence()?.firstOrNull()?.takeIf { it.isNotBlank() } ?: "Mise en ligne",
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    fontSize = 14.sp,
                )
                Text(
                    listOfNotNull(label, d.gitSha?.take(7), relativeTime(d.createdAt).takeIf { it.isNotEmpty() }).joinToString(" · "),
                    color = DfColors.InkFaint,
                    fontSize = 12.sp,
                )
                if (d.isFailed && !d.errorSummary.isNullOrBlank()) {
                    Text(d.errorSummary, color = DfColors.Danger, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            Text("Logs", color = DfColors.Accent, fontSize = 13.sp, modifier = Modifier.padding(start = 8.dp))
        }
    }
}

fun deployLabel(d: Deployment): Pair<String, Color> = when {
    d.isFailed -> "Échec" to DfColors.Danger
    d.isRunning -> "En cours" to DfColors.Warn
    d.isSuccess -> "En ligne" to DfColors.Ok
    else -> d.status to DfColors.InkFaint
}

/** Fondu des bords d'une rangée défilante (indique qu'il y a une suite, sans couper un élément net). */
private fun Modifier.fadingEdges(start: Boolean, end: Boolean, width: Dp = 28.dp): Modifier =
    graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen).drawWithContent {
        drawContent()
        val w = width.toPx()
        if (start) {
            drawRect(Brush.horizontalGradient(listOf(Color.Transparent, Color.Black), startX = 0f, endX = w), blendMode = BlendMode.DstIn)
        }
        if (end) {
            drawRect(Brush.horizontalGradient(listOf(Color.Black, Color.Transparent), startX = size.width - w, endX = size.width), blendMode = BlendMode.DstIn)
        }
    }

