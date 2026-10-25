package app.jeser.devforge.ui.project

import app.jeser.devforge.ui.components.NavSheet
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.AppStatus
import app.jeser.devforge.data.ContainerState
import app.jeser.devforge.data.DeployPlan
import app.jeser.devforge.data.Deployment
import app.jeser.devforge.data.SpecFeature
import app.jeser.devforge.ui.apps.hostOf
import app.jeser.devforge.ui.components.AppIcon
import app.jeser.devforge.ui.components.ConfirmActionSheet
import app.jeser.devforge.ui.components.DfTile
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
    val onOpenCorrections: () -> Unit = {},
    val onApplyCorrection: (() -> Unit) -> Unit = {},
    val onRejectCorrection: (() -> Unit) -> Unit = {},
    val onRedoCorrection: (() -> Unit) -> Unit = {},
    val onRestoreCorrection: (String) -> Unit = {},
    val onDraftValidate: (String) -> Unit = {},
    val onDraftDiscard: (() -> Unit) -> Unit = {},
    val onDraftRevert: (String, () -> Unit) -> Unit = { _, _ -> },
    val onDraftRestore: (String) -> Unit = {},
    val onDraftUpdate: () -> Unit = {},
    val onDraftValidatedSeen: () -> Unit = {},
    val onUndoShown: () -> Unit = {},
    val onCancelJob: (String) -> Unit = {},
    val onControlJob: (String, String) -> Unit = { _, _ -> },
    /* P5 : question `ask_user`, réactions, images jointes. */
    val onAnswer: (ChatItem, app.jeser.devforge.data.QuestionOption?, String?) -> Unit = { _, _, _ -> },
    val onReact: (ChatItem, String) -> Unit = { _, _ -> },
    val onAttachImage: (ByteArray, String, String) -> Unit = { _, _, _ -> },
    val onRemoveImage: (String) -> Unit = {},
    val attachmentUrl: (String) -> String? = { null },
)

/** Feuilles de la page app (une seule ouverte à la fois). */
enum class ProjectSheet { None, Details, Deploys, Stop, Restart, Deploy, NewFeature, Workspace, Draft, DraftFile, DraftValidate, DraftDiscard, Chat, Corrections }

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
    LaunchedEffect(Unit) {
        if (initialSheet == ProjectSheet.Draft) actions.onOpenDraft()
        if (initialSheet == ProjectSheet.Corrections) actions.onOpenCorrections()
    }
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
    // Fermer le brouillon ramène au Workspace s'il a été ouvert depuis là.
    var draftFromWorkspace by rememberSaveable { mutableStateOf(false) }
    var fileFromCorrections by rememberSaveable { mutableStateOf(false) }
    val openDraft = { actions.onOpenDraft(); sheet = ProjectSheet.Draft }
    // Tuile Workspace : brouillon en attente → directement le brouillon ; sinon les tuiles du Workspace.
    val openCorrections = { actions.onOpenCorrections(); sheet = ProjectSheet.Corrections }
    val openWorkspace = {
        actions.onOpenDraft()
        if (state.draft?.dirty == true) {
            draftFromWorkspace = true
            sheet = ProjectSheet.Draft
        } else {
            sheet = ProjectSheet.Workspace
        }
    }
    Scaffold(
        modifier = modifier,
        containerColor = DfColors.Bg,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            // Barre du haut épurée : retour + app. Les actions vivent dans la barre d'actions sous le statut.
            TopAppBar(
                title = {
                    if (project != null) {
                        Text(project.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
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
                    // Colonne gauche du grand écran (400 dp) : icônes seules, comme sur téléphone.
                    val labels = maxWidth >= 600.dp && !wide
                    val narrowCols = if (maxWidth >= 600.dp) 4 else 2
                    val overview: @Composable (Int, Boolean) -> Unit = { cols, showBraise ->
                        StatusCard(state)
                        ActionBar(
                            state,
                            labels = labels,
                            onDeploy = {
                                if (state.deployPlan.kind == DeployPlan.Kind.InProgress) {
                                    state.latest?.let(actions.onOpenLogs) ?: actions.onOpenRuntimeLogs()
                                } else {
                                    sheet = ProjectSheet.Deploy
                                }
                            },
                            onRestart = { sheet = ProjectSheet.Restart },
                            onStop = { sheet = ProjectSheet.Stop },
                            onStart = { actions.onLifecycle("start") },
                            onLogs = actions.onOpenRuntimeLogs,
                        )
                        ProjectTiles(
                            state,
                            cols = cols,
                            showBraise = showBraise,
                            onBraise = { sheet = ProjectSheet.Chat },
                            onWorkspace = openCorrections,
                            onPreview = actions.onOpenPreview,
                            onDeploys = { sheet = ProjectSheet.Deploys },
                            onSettings = { sheet = ProjectSheet.Details },
                        )
                    }
                    if (wide) {
                        // Grand écran : vue d'ensemble à gauche, Braise toujours visible à droite.
                        Row(Modifier.fillMaxSize()) {
                            Column(
                                Modifier.width(400.dp).fillMaxHeight().verticalScroll(rememberScrollState())
                                    .padding(start = 20.dp, end = 16.dp, bottom = 16.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) { overview(3, false) }
                            VerticalDivider(color = DfColors.Line)
                            ChatPane(state, input, { input = it }, actions, onNewFeature = { sheet = ProjectSheet.NewFeature }, modifier = Modifier.weight(1f))
                        }
                    } else {
                        // Téléphone / tablette : statut, barre d'actions, tuiles. Chaque tuile ouvre une feuille.
                        val side = if (maxWidth >= 600.dp) 24.dp else 16.dp
                        Column(
                            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                                .padding(horizontal = side).padding(bottom = 16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) { overview(narrowCols, true) }
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
            ProjectSheet.Workspace -> WorkspaceSheet(
                state,
                onDismiss = close,
                onDraft = { draftFromWorkspace = true; openDraft() },
                onPreview = { actions.onOpenPreview(); close() },
                onBraise = { sheet = ProjectSheet.Chat },
            )
            ProjectSheet.Draft -> DraftSheet(
                state,
                onDismiss = { if (draftFromWorkspace) { draftFromWorkspace = false; sheet = ProjectSheet.Workspace } else close() },
                onOpenDiscussion = { sheet = ProjectSheet.Chat },
                onOpenFile = { p -> draftPath = p; fileFromCorrections = false; sheet = ProjectSheet.DraftFile },
                onValidate = { actions.onDraftValidatedSeen(); sheet = ProjectSheet.DraftValidate },
                onDiscard = { sheet = ProjectSheet.DraftDiscard },
                onUpdate = actions.onDraftUpdate,
                onRestore = actions.onDraftRestore,
                onOpenPreview = { actions.onOpenPreview(); close() },
            )
            ProjectSheet.Corrections -> CorrectionsSheet(
                state,
                onDismiss = close,
                onOpenFile = { p -> draftPath = p; fileFromCorrections = true; sheet = ProjectSheet.DraftFile },
                onApply = actions.onApplyCorrection,
                onReject = actions.onRejectCorrection,
                onRedo = actions.onRedoCorrection,
                onRestore = actions.onRestoreCorrection,
            )
            ProjectSheet.DraftFile -> DraftFileSheet(
                state,
                path = draftPath.orEmpty(),
                onBack = { sheet = if (fileFromCorrections) ProjectSheet.Corrections else ProjectSheet.Draft },
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
            // Braise dans la zone de contenu : la barre du bas reste visible, la saisie juste au-dessus.
            ProjectSheet.Chat -> NavSheet(onDismissRequest = close) {
                ChatPane(
                    state, input, { input = it }, actions,
                    onNewFeature = { sheet = ProjectSheet.NewFeature },
                    modifier = Modifier.fillMaxHeight().padding(horizontal = 4.dp),
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

/* ---------------- Statut unique ---------------- */

/** Un seul statut : mise en ligne en cours / échouée d'abord, sinon l'état réel de l'app. */
data class Headline(val label: String, val detail: String?, val color: Color)

fun headlineOf(state: ProjectUiState): Headline {
    val s = state.summary
    val latest = state.latest
    val plan = state.deployPlan
    return when {
        plan.kind == DeployPlan.Kind.InProgress -> Headline("Mise en ligne en cours", plan.summary, DfColors.Warn)
        latest?.isFailed == true -> Headline(
            "Échec de la mise en ligne",
            if (s.status == AppStatus.Live) "L'ancienne version reste en ligne" else latest.errorSummary?.lineSequence()?.firstOrNull(),
            DfColors.Danger,
        )
        else -> Headline(
            s.status.label,
            if (plan.primary) plan.summary
            else listOfNotNull(s.since, s.healthOk?.let { if (it) "santé OK" else "ne répond pas" }).joinToString(" · ").ifBlank { null },
            s.status.color(),
        )
    }
}

/** Icône + statut + pastille URL (ouvrir / copier). Pas de répétition : rien d'autre ne redit le statut. */
@Composable
fun StatusCard(state: ProjectUiState, modifier: Modifier = Modifier) {
    val project = state.project ?: return
    val h = headlineOf(state)
    val uri = LocalUriHandler.current
    val clip = LocalClipboardManager.current
    val url = project.productionUrl?.split(',')?.firstOrNull()?.trim()?.takeIf { it.isNotBlank() }
        ?.let { if (it.startsWith("http")) it else "https://$it" }
    Surface(
        color = TileBg,
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, if (h.color == DfColors.Danger) DfColors.Danger.copy(alpha = .35f) else Color.Transparent),
        modifier = modifier.fillMaxWidth().testTag("status"),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AppIcon(project.name, project.productionUrl, project.gitRepository, status = state.summary.status, size = 44.dp)
                Column(Modifier.weight(1f).padding(start = 12.dp).semantics(mergeDescendants = true) {}) {
                    Text(h.label, color = h.color, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    h.detail?.let { Text(it, color = DfColors.InkMuted, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                }
            }
            if (url != null) {
                Surface(
                    color = DfColors.Card,
                    shape = RoundedCornerShape(50),
                    border = BorderStroke(1.dp, DfColors.Line),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Row(
                            Modifier.weight(1f).heightIn(min = 48.dp)
                                .clickable(role = Role.Button, onClickLabel = "Ouvrir le site") { runCatching { uri.openUri(url) } }
                                .padding(start = 14.dp, end = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Filled.Public, contentDescription = null, tint = DfColors.InkMuted, modifier = Modifier.size(18.dp))
                            Text(
                                hostOf(url).orEmpty(), color = DfColors.Ink, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false).padding(horizontal = 8.dp),
                            )
                            Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, tint = DfColors.InkFaint, modifier = Modifier.size(16.dp))
                        }
                        VerticalDivider(Modifier.height(28.dp), color = DfColors.Line)
                        IconButton(onClick = { clip.setText(AnnotatedString(url)) }, modifier = Modifier.size(48.dp)) {
                            Icon(Icons.Filled.ContentCopy, contentDescription = "Copier l'adresse", tint = DfColors.InkMuted, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
    }
}

/* ---------------- Barre d'actions ---------------- */

/**
 * Mettre en ligne (principal), Redémarrer, Arrêter / Démarrer, Logs.
 * Téléphone : icônes 48 dp sauf l'action principale ; tablette : icône + libellé.
 * Mettre en ligne / Reconstruire, Redémarrer et Arrêter ouvrent toujours une confirmation.
 */
@Composable
fun ActionBar(
    state: ProjectUiState,
    labels: Boolean,
    onDeploy: () -> Unit,
    onRestart: () -> Unit,
    onStop: () -> Unit,
    onStart: () -> Unit,
    onLogs: () -> Unit,
) {
    val plan = state.deployPlan
    val running = state.containerState.running
    val inProgress = plan.kind == DeployPlan.Kind.InProgress
    val primaryLabel = when {
        inProgress -> "En cours…"
        plan.primary -> plan.shortLabel
        plan.kind == DeployPlan.Kind.Rebuild -> "Reconstruire"
        else -> "Mettre en ligne"
    }
    val danger = plan.kind == DeployPlan.Kind.Retry
    Row(
        Modifier.fillMaxWidth().testTag("actions"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            onClick = onDeploy,
            enabled = inProgress || state.canDeploy,
            shape = RoundedCornerShape(50),
            colors = ButtonDefaults.buttonColors(
                containerColor = if (danger) DfColors.Danger else DfColors.Accent,
                contentColor = if (danger) Color.White else DfColors.OnAccent,
            ),
            contentPadding = PaddingValues(horizontal = 16.dp),
            modifier = Modifier.weight(1f).heightIn(min = 48.dp),
        ) {
            if (inProgress || state.deploying) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = DfColors.OnAccent)
            } else {
                Icon(if (danger) Icons.Filled.Refresh else Icons.Filled.CloudUpload, contentDescription = null, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(8.dp))
            Text(primaryLabel, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        BarButton(Icons.Filled.RestartAlt, "Redémarrer", labels, onRestart, enabled = state.canControl && running, busy = state.lifecycleBusy == "restart")
        if (running || state.lifecycleBusy == "stop") {
            BarButton(Icons.Filled.Stop, "Arrêter", labels, onStop, enabled = state.canControl, busy = state.lifecycleBusy == "stop", tint = DfColors.Danger)
        } else {
            BarButton(
                Icons.Filled.PlayArrow, "Démarrer", labels, onStart,
                enabled = state.canControl && state.containerState.kind != ContainerState.Kind.Missing,
                busy = state.lifecycleBusy == "start", tint = DfColors.Ok,
            )
        }
        BarButton(Icons.AutoMirrored.Filled.Subject, "Logs", labels, onLogs)
    }
}

@Composable
private fun BarButton(
    icon: ImageVector,
    label: String,
    showLabel: Boolean,
    onClick: () -> Unit,
    enabled: Boolean = true,
    busy: Boolean = false,
    tint: Color = DfColors.Ink,
) {
    val a = if (enabled) 1f else .4f
    OutlinedButton(
        onClick = onClick,
        enabled = enabled && !busy,
        shape = RoundedCornerShape(50),
        border = BorderStroke(1.dp, DfColors.LineStrong.copy(alpha = a)),
        contentPadding = PaddingValues(horizontal = if (showLabel) 14.dp else 0.dp),
        modifier = Modifier.heightIn(min = 48.dp).widthIn(min = 48.dp).semantics { contentDescription = label },
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = tint)
        } else {
            Icon(icon, contentDescription = null, tint = tint.copy(alpha = a), modifier = Modifier.size(20.dp))
        }
        if (showLabel) {
            Spacer(Modifier.width(8.dp))
            Text(label, color = DfColors.Ink.copy(alpha = a), maxLines = 1)
        }
    }
}

/* ---------------- Tuiles ---------------- */

private data class TileSpec(
    val key: String,
    val title: String,
    val sub: String,
    val icon: ImageVector,
    val tone: Color,
    val alert: Boolean,
    val onClick: () -> Unit,
)

/** Braise, Workspace, Déploiements, Paramètres : chaque tuile ouvre sa feuille (jamais de détail sous la grille). */
@Composable
fun ProjectTiles(
    state: ProjectUiState,
    cols: Int,
    showBraise: Boolean,
    onBraise: () -> Unit,
    onWorkspace: () -> Unit,
    onDeploys: () -> Unit,
    onSettings: () -> Unit,
    onPreview: () -> Unit = {},
) {
    val draft = state.draft
    val latest = state.latest
    val tiles = buildList {
        if (showBraise) {
            val waiting = state.waitingSpecs.isNotEmpty()
            add(TileSpec("braise", "Braise", if (waiting) "Attend ton OK" else "Discuter, faire évoluer", Icons.Filled.LocalFireDepartment,
                if (waiting) DfColors.Warn else DfColors.Accent, waiting, onBraise))
        }
        val cur = state.corrections?.current
        val alert = cur != null && cur.stage in setOf("proposed", "conflict", "failed")
        add(TileSpec("corrections", "Corrections", correctionsTileText(state.corrections), Icons.Filled.Build,
            cur?.let { correctionTone(it.stage) } ?: DfColors.InkMuted, alert, onWorkspace))
        val running = state.preview?.running == true
        add(TileSpec("preview", "Aperçu", if (state.previewStarting) "Démarrage…" else if (running) "En marche" else "Arrêté",
            Icons.Filled.PlayArrow, if (running) DfColors.Ok else DfColors.InkMuted, false, onPreview))
        val (dl, dc) = latest?.let { deployLabel(it) } ?: ("Aucune" to DfColors.InkFaint)
        val when_ = latest?.let { relativeTime(it.createdAt) }?.takeIf { it.isNotEmpty() }
        add(TileSpec("deploys", "Déploiements", listOfNotNull(dl, when_).joinToString(" · "), Icons.Filled.History,
            dc, latest?.isFailed == true, onDeploys))
        add(TileSpec("settings", "Paramètres", "Domaine, GitHub, équipe", Icons.Filled.Settings, DfColors.InkMuted, false, onSettings))
    }
    Column(Modifier.fillMaxWidth().testTag("tiles"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        tiles.chunked(cols).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { t ->
                    DfTile(
                        onClick = t.onClick,
                        tone = if (t.alert) t.tone else null,
                        minHeight = 116.dp,
                        contentDescription = "${t.title} : ${t.sub}",
                        modifier = Modifier.weight(1f).testTag("tile-${t.key}"),
                    ) {
                        Box(Modifier.size(44.dp).background(t.tone.copy(alpha = .14f), RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
                            Icon(t.icon, contentDescription = null, tint = t.tone, modifier = Modifier.size(22.dp))
                        }
                        Text(t.title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(t.sub, color = if (t.alert) t.tone else DfColors.InkMuted, fontSize = 12.sp, maxLines = 2,
                            overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                    }
                }
                repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
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
        add(Chip("health", "🩺 Ça va ?"))
        add(Chip("design", "🎨 Design"))
    }
    val canChat = state.coordinatorUuid != null && !state.sending
    // P5-04 : réponses aux questions, indexées par uuid du message de l'agent.
    val answers = remember(state.messages) { state.messages.mapNotNull { m -> m.answer?.let { a -> a.answerTo?.let { it to a } } }.toMap() }
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
                MessageRow(
                    m,
                    showPlanAction = m.key == lastPlanKey && canChat,
                    onBuild = { actions.onSend(ChipText.BUILD_PLAN) },
                    onCancelJob = actions.onCancelJob,
                    onControlJob = actions.onControlJob,
                    rich = RichRowState(
                        questionOpen = m.key == state.messages.lastOrNull()?.key && canChat,
                        answer = m.uuid?.let { answers[it] },
                        canReact = m.uuid != null && !state.sending,
                    ),
                    actions = actions,
                )
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
        if (state.pendingImages.isNotEmpty()) PendingImagesRow(state.pendingImages, onRemove = actions.onRemoveImage)
        Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 10.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            AttachImageButton(enabled = state.coordinatorUuid != null && state.pendingImages.size < 4, onPicked = actions.onAttachImage)
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
                modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("chat-input"),
            )
            FilledIconButton(
                onClick = {
                    actions.onSend(input)
                    onInput("")
                },
                enabled = canChat && (input.isNotBlank() || state.pendingImages.any { it.status == "ready" }) && state.pendingImages.none { it.status == "uploading" },
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
private fun MessageRow(
    m: ChatItem,
    showPlanAction: Boolean,
    onBuild: () -> Unit,
    onCancelJob: (String) -> Unit = {},
    onControlJob: (String, String) -> Unit = { _, _ -> },
    rich: RichRowState = RichRowState(),
    actions: ProjectActions = ProjectActions(),
) {
    when (m.role) {
        "user" -> if (m.answer != null) {
            AnswerBubble(m.answer)
        } else Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (m.attachments.isNotEmpty()) ImageGridRow(m.attachments, actions.attachmentUrl)
            if (m.content.isNotBlank()) Surface(
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
                val sameAsQuestion = m.question != null && m.content.trim() == m.question.question.trim()
                if (!sameAsQuestion) Surface(
                    color = DfColors.Card,
                    shape = RoundedCornerShape(4.dp, 18.dp, 18.dp, 18.dp),
                    border = BorderStroke(1.dp, DfColors.Line),
                ) {
                    SelectionContainer {
                        MarkdownText(m.content.ifBlank { "…" }, Modifier.padding(horizontal = 14.dp, vertical = 10.dp))
                    }
                }
                m.question?.let { q ->
                    QuestionCardRow(q, open = rich.questionOpen, answer = rich.answer, onAnswer = { opt, text -> actions.onAnswer(m, opt, text) })
                }
                m.jobs.forEach { job -> JobCardRow(job, onCancel = { onCancelJob(job.id) }, onControl = { a -> onControlJob(job.id, a) }) }
                if (m.reactions.isNotEmpty() || rich.canReact) {
                    ReactionsRow(m.reactions, enabled = rich.canReact, onToggle = { e -> actions.onReact(m, e) })
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
                    listOfNotNull(d.envLabel, label, d.gitSha?.take(7), relativeTime(d.createdAt).takeIf { it.isNotEmpty() }).joinToString(" · "),
                    color = if (d.isDev) DfColors.Warn else DfColors.InkFaint,
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

