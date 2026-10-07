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
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.RocketLaunch
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.AppStatus
import app.jeser.devforge.data.ContainerState
import app.jeser.devforge.data.Deployment
import app.jeser.devforge.data.SpecFeature
import app.jeser.devforge.data.Tone
import app.jeser.devforge.data.syncLabel
import app.jeser.devforge.ui.apps.hostOf
import app.jeser.devforge.ui.components.AppIcon
import app.jeser.devforge.ui.components.ConfirmActionSheet
import app.jeser.devforge.ui.components.Persona
import app.jeser.devforge.ui.components.PersonaAvatar
import app.jeser.devforge.ui.components.PersonaMessage
import app.jeser.devforge.ui.components.TileBg
import app.jeser.devforge.ui.components.TileLabel
import app.jeser.devforge.ui.components.color
import app.jeser.devforge.ui.components.persona
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
)

/** Feuilles de la page app (une seule ouverte à la fois). */
enum class ProjectSheet { None, Status, Deploys, Domain, Team, Stop, Restart, Deploy, NewFeature }

private data class Chip(val key: String, val label: String, val danger: Boolean = false)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ProjectScreen(
    state: ProjectUiState,
    actions: ProjectActions,
    modifier: Modifier = Modifier,
    initialSheet: ProjectSheet = ProjectSheet.None,
) {
    var sheet by rememberSaveable { mutableStateOf(initialSheet) }
    var input by rememberSaveable { mutableStateOf("") }
    val snackbar = remember { SnackbarHostState() }
    val uri = LocalUriHandler.current

    LaunchedEffect(state.notice) {
        state.notice?.let {
            snackbar.showSnackbar(it)
            actions.onNoticeShown()
        }
    }
    LaunchedEffect(state.openUrl) {
        state.openUrl?.let { runCatching { uri.openUri(it) }; actions.onUrlOpened() }
    }

    val project = state.project
    val summary = state.summary
    Scaffold(
        modifier = modifier,
        containerColor = DfColors.Bg,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {
                    if (project != null) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            AppIcon(project.name, project.productionUrl, project.gitRepository, status = null, size = 32.dp)
                            Column(Modifier.padding(start = 8.dp)) {
                                Text(project.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                                Text(
                                    listOfNotNull(summary.status.label, summary.since).joinToString(" · "),
                                    color = summary.status.color(),
                                    fontSize = 12.5.sp,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                },
                navigationIcon = {
                    actions.onBack?.let { back ->
                        IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour aux apps") }
                    }
                },
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
                    val onSheet: (ProjectSheet) -> Unit = { sheet = it }
                    if (wide) {
                        Row(Modifier.fillMaxSize()) {
                            Column(
                                Modifier.width(400.dp).fillMaxHeight().verticalScroll(rememberScrollState())
                                    .padding(start = 20.dp, end = 16.dp, bottom = 16.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                StatusTiles(state, columns = 2, onSheet = onSheet)
                                ActionRow(state, actions, onSheet = onSheet)
                                RecentDeploys(state, onOpen = actions.onOpenLogs)
                            }
                            VerticalDivider(color = DfColors.Line)
                            ChatPane(state, input, { input = it }, actions, onNewFeature = { sheet = ProjectSheet.NewFeature }, modifier = Modifier.weight(1f))
                        }
                    } else {
                        // Hauteur réelle du clavier (isImeVisible vaut true tant que les insets ne sont pas connus).
                        val imeOpen = WindowInsets.ime.getBottom(LocalDensity.current) > 0
                        val cols = if (maxWidth >= 600.dp) 4 else 2
                        val side = if (maxWidth >= 600.dp) 24.dp else 16.dp
                        Column(Modifier.fillMaxSize()) {
                            // Clavier ouvert : on replie l'état pour laisser la place à la discussion.
                            AnimatedVisibility(visible = !imeOpen) {
                                Column(Modifier.padding(horizontal = side), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    StatusTiles(state, columns = cols, onSheet = onSheet)
                                    ActionRow(state, actions, onSheet = onSheet)
                                }
                            }
                            HorizontalDivider(color = DfColors.Line, modifier = Modifier.padding(top = 10.dp))
                            ChatPane(state, input, { input = it }, actions, onNewFeature = { sheet = ProjectSheet.NewFeature }, modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }

    if (project != null) {
        val close = { sheet = ProjectSheet.None }
        when (sheet) {
            ProjectSheet.Status -> StatusSheet(state, onDismiss = close)
            ProjectSheet.Deploys -> DeploysSheet(state, onDismiss = close, onOpen = { d -> sheet = ProjectSheet.None; actions.onOpenLogs(d) })
            ProjectSheet.Domain -> DomainSheet(state, onDismiss = close)
            ProjectSheet.Team -> TeamSheet(state, onDismiss = close)
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
                busy = state.deploying,
                onDismiss = close,
                onConfirm = { msg -> actions.onDeploy(msg); sheet = ProjectSheet.None },
            )
            ProjectSheet.NewFeature -> NewFeatureSheet(
                busy = state.creatingSpec,
                onDismiss = close,
                onSubmit = { t, d -> actions.onCreateSpec(t, d) { sheet = ProjectSheet.None } },
            )
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

/* ---------------- Tuiles d'état ---------------- */

@Composable
private fun InfoTile(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: Color? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        onClick = onClick,
        color = TileBg,
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, tone?.copy(alpha = .35f) ?: Color.Transparent),
        modifier = modifier.heightIn(min = 80.dp),
    ) {
        Column(
            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            TileLabel(label)
            content()
        }
    }
}

@Composable
private fun TileValue(text: String, color: Color = DfColors.Ink) {
    Text(text, color = color, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun TileSub(text: String, color: Color = DfColors.InkMuted) {
    Text(text, color = color, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

/** État, dernier déploiement, domaine, équipe : un toucher ouvre le détail dans une feuille. */
@Composable
fun StatusTiles(state: ProjectUiState, columns: Int, onSheet: (ProjectSheet) -> Unit) {
    val project = state.project ?: return
    val summary = state.summary
    val latest = state.latest
    val host = hostOf(project.productionUrl)
    val tiles: List<@Composable (Modifier) -> Unit> = listOf(
        { m ->
            InfoTile("État", onClick = { onSheet(ProjectSheet.Status) }, modifier = m,
                tone = summary.status.color().takeIf { summary.status in setOf(AppStatus.Failed, AppStatus.Down) }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).background(summary.status.color(), CircleShape))
                    Spacer(Modifier.width(6.dp))
                    TileValue(summary.status.label, summary.status.color())
                }
                val healthShort = if (summary.healthOk == true) "Santé : OK" else summary.health
                TileSub(summary.since ?: healthShort, if (summary.since == null && summary.healthOk == false) DfColors.Danger else DfColors.InkMuted)
                if (summary.since != null) {
                    TileSub(healthShort, if (summary.healthOk == false) DfColors.Danger else DfColors.InkFaint)
                }
            }
        },
        { m ->
            val (label, color) = latest?.let { deployLabel(it) } ?: ("Aucune" to DfColors.InkFaint)
            InfoTile("Dernier déploiement", onClick = { onSheet(ProjectSheet.Deploys) }, modifier = m,
                tone = DfColors.Danger.takeIf { latest?.isFailed == true }) {
                TileValue(latest?.gitMessage?.lineSequence()?.firstOrNull()?.takeIf { it.isNotBlank() } ?: if (latest == null) "Pas encore publié" else "Mise en ligne")
                TileSub(listOfNotNull(label, latest?.let { relativeTime(it.createdAt).takeIf { r -> r.isNotEmpty() } }).joinToString(" · "), color)
                syncLabel(state.git)?.let { TileSub(it.removePrefix("GitHub : ").replaceFirstChar { c -> c.uppercase() }.let { s -> "GitHub · $s" }, DfColors.InkFaint) }
            }
        },
        { m ->
            InfoTile("Domaine", onClick = { onSheet(ProjectSheet.Domain) }, modifier = m) {
                TileValue(host ?: "Pas de domaine", if (host != null) DfColors.Accent else DfColors.InkFaint)
                TileSub(
                    when {
                        host == null -> "Le brouillon reste local"
                        summary.healthOk == true -> "HTTPS · répond"
                        summary.healthOk == false -> "HTTPS · ne répond pas"
                        else -> "HTTPS"
                    },
                    if (summary.healthOk == false && host != null) DfColors.Danger else DfColors.InkMuted,
                )
            }
        },
        { m ->
            val team = state.team
            val top = team.firstOrNull { it.tone == Tone.Warn || it.tone == Tone.Danger } ?: team.firstOrNull { it.tone == Tone.Accent }
            InfoTile("Équipe", onClick = { onSheet(ProjectSheet.Team) }, modifier = m) {
                Row(horizontalArrangement = Arrangement.spacedBy((-6).dp)) {
                    team.forEach { PersonaAvatar(it.key.persona(), 24.dp) }
                }
                TileSub(
                    top?.let { "${it.key.persona().displayName} · ${it.label.lowercase()}" } ?: "Tout le monde veille",
                    top?.tone?.color() ?: DfColors.InkMuted,
                )
            }
        },
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        tiles.chunked(columns).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.height(IntrinsicSize.Min)) {
                row.forEach { tile -> tile(Modifier.weight(1f).fillMaxHeight()) }
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/* ---------------- Boutons de contrôle ---------------- */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ActionButton(
    icon: ImageVector,
    label: String,
    tooltip: String,
    shortLabel: String = label,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    tint: Color = DfColors.Ink,
    filled: Boolean = false,
) {
    val alpha = if (enabled) 1f else .38f
    // Le poids (weight) s'applique à ce Box : TooltipBox ne le transmet pas à son ancre.
    BoxWithConstraints(modifier) {
    val narrow = maxWidth < 66.dp
    TooltipBox(
        positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(tooltip) } },
        state = rememberTooltipState(),
    ) {
        Surface(
            onClick = onClick,
            enabled = enabled && !busy,
            color = Color.Transparent,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp).semantics {
                contentDescription = tooltip
                role = Role.Button
            },
        ) {
            Column(
                Modifier.padding(vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Box(
                    Modifier.size(44.dp).background(
                        if (filled) tint.copy(alpha = alpha) else tint.copy(alpha = .12f * alpha),
                        RoundedCornerShape(14.dp),
                    ),
                    contentAlignment = Alignment.Center,
                ) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = if (filled) DfColors.OnAccent else tint)
                    } else {
                        Icon(icon, contentDescription = null, tint = if (filled) DfColors.OnAccent else tint.copy(alpha = alpha), modifier = Modifier.size(22.dp))
                    }
                }
                // Libellé court quand la place manque (téléphone 360 dp) ; le libellé complet reste dans l'info-bulle.
                Text(
                    if (narrow) shortLabel else label,
                    color = DfColors.InkMuted.copy(alpha = alpha),
                    fontSize = 11.sp,
                    lineHeight = 13.sp,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                )
            }
        }
    }
}
}

/** Contrôle de l'app : ouvrir, aperçu, redémarrer, arrêter / démarrer, logs, mettre en ligne. */
@Composable
fun ActionRow(state: ProjectUiState, actions: ProjectActions, onSheet: (ProjectSheet) -> Unit) {
    val project = state.project ?: return
    val uri = LocalUriHandler.current
    val c = state.containerState
    val running = c.running
    val url = project.productionUrl?.split(',')?.firstOrNull()?.trim()
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        val m = Modifier.weight(1f)
        ActionButton(
            Icons.AutoMirrored.Filled.OpenInNew, "Ouvrir", "Ouvrir le site en ligne",
            onClick = { url?.let { runCatching { uri.openUri(if (it.startsWith("http")) it else "https://$it") } } },
            enabled = !url.isNullOrBlank(), modifier = m,
        )
        ActionButton(
            Icons.Filled.Visibility, "Aperçu", "Aperçu du brouillon (local, rien n'est publié)",
            onClick = actions.onOpenPreview, busy = state.previewStarting, modifier = m,
        )
        ActionButton(
            Icons.Filled.RestartAlt, "Redémarrer", "Redémarrer le conteneur (avec confirmation)", shortLabel = "Relancer",
            onClick = { onSheet(ProjectSheet.Restart) },
            enabled = state.canControl && running, busy = state.lifecycleBusy == "restart", modifier = m,
        )
        if (running || state.lifecycleBusy == "stop") {
            ActionButton(
                Icons.Filled.Stop, "Arrêter", "Arrêter l'app (avec confirmation)",
                onClick = { onSheet(ProjectSheet.Stop) },
                enabled = state.canControl, busy = state.lifecycleBusy == "stop", tint = DfColors.Danger, modifier = m,
            )
        } else {
            ActionButton(
                Icons.Filled.PlayArrow, "Démarrer", "Démarrer l'app",
                onClick = { actions.onLifecycle("start") },
                enabled = state.canControl && c.kind != ContainerState.Kind.Missing,
                busy = state.lifecycleBusy == "start", tint = DfColors.Ok, modifier = m,
            )
        }
        ActionButton(
            Icons.AutoMirrored.Filled.Subject, "Logs", "Logs de l'app et de la dernière mise en ligne",
            onClick = actions.onOpenRuntimeLogs, modifier = m,
        )
        ActionButton(
            Icons.Filled.RocketLaunch, "Mettre en ligne", "Reconstruire depuis GitHub et publier (avec confirmation)",
            onClick = { onSheet(ProjectSheet.Deploy) },
            enabled = state.canDeploy, busy = state.deploying || state.latest?.isRunning == true,
            tint = DfColors.Accent, filled = true, modifier = m,
        )
    }
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
        if (state.lastFailed) add(Chip("repair", "🩹 Répare la mise en ligne", danger = true))
        add(Chip("feature", "✨ Nouvelle fonctionnalité"))
        add(Chip("health", "🩺 Est-ce que tout va bien ?"))
        add(Chip("design", "🎨 Améliore le design"))
    }
    val canChat = state.coordinatorUuid != null && !state.sending
    val lastPlanKey = state.messages.lastOrNull { it.hasPlan }?.key
        ?.takeIf { key -> state.messages.lastOrNull { it.role == "assistant" }?.key == key }

    Column(modifier.fillMaxWidth()) {
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
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
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
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
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Box(Modifier.padding(horizontal = 14.dp).heightIn(min = 48.dp), contentAlignment = Alignment.Center) {
                        Text(chip.label, color = if (canChat) c else c.copy(alpha = .4f), fontSize = 14.sp)
                    }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
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
