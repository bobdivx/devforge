package app.jeser.devforge.ui.project

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.Deployment
import app.jeser.devforge.data.SpecFeature
import app.jeser.devforge.ui.apps.hostOf
import app.jeser.devforge.ui.components.Persona
import app.jeser.devforge.ui.components.PersonaAvatar
import app.jeser.devforge.ui.components.PersonaMessage
import app.jeser.devforge.ui.components.StatusPill
import app.jeser.devforge.ui.components.relativeTime
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
)

private data class Chip(val key: String, val label: String, val danger: Boolean = false)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectScreen(
    state: ProjectUiState,
    actions: ProjectActions,
    modifier: Modifier = Modifier,
    initialDeployConfirm: Boolean = false,
    initialNewFeature: Boolean = false,
) {
    var confirmDeploy by rememberSaveable { mutableStateOf(initialDeployConfirm) }
    var newFeature by rememberSaveable { mutableStateOf(initialNewFeature) }
    var input by rememberSaveable { mutableStateOf("") }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(state.notice) {
        state.notice?.let {
            snackbar.showSnackbar(it)
            actions.onNoticeShown()
        }
    }

    val project = state.project
    Scaffold(
        modifier = modifier,
        containerColor = DfColors.Bg,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(project?.name ?: "", maxLines = 1, overflow = TextOverflow.Ellipsis) },
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
                    val wide = maxWidth >= 760.dp
                    Column(Modifier.fillMaxSize()) {
                        ProjectHeader(state, onDeploy = { confirmDeploy = true })
                        if (wide) {
                            HorizontalDivider(color = DfColors.Line)
                            Row(Modifier.fillMaxSize()) {
                                ChatPane(state, input, { input = it }, actions, onNewFeature = { newFeature = true }, modifier = Modifier.weight(1f))
                                VerticalDivider(color = DfColors.Line)
                                DeploysPane(state, actions.onOpenLogs, modifier = Modifier.width(320.dp).fillMaxHeight())
                            }
                        } else {
                            TabRow(
                                selectedTabIndex = tab,
                                containerColor = DfColors.Bg,
                                contentColor = DfColors.Ink,
                                indicator = { pos ->
                                    TabRowDefaults.SecondaryIndicator(Modifier.tabIndicatorOffset(pos[tab]), color = DfColors.Accent)
                                },
                                divider = { HorizontalDivider(color = DfColors.Line) },
                            ) {
                                Tab(selected = tab == 0, onClick = { tab = 0 }, modifier = Modifier.height(48.dp),
                                    text = { Text("🔥 Braise") })
                                Tab(selected = tab == 1, onClick = { tab = 1 }, modifier = Modifier.height(48.dp),
                                    text = {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Text("Mises en ligne")
                                            if (state.lastFailed) {
                                                Spacer(Modifier.width(6.dp))
                                                Box(Modifier.size(8.dp).background(DfColors.Danger, CircleShape))
                                            }
                                        }
                                    })
                            }
                            if (tab == 0) {
                                ChatPane(state, input, { input = it }, actions, onNewFeature = { newFeature = true }, modifier = Modifier.weight(1f))
                            } else {
                                DeploysPane(state, actions.onOpenLogs, modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }
            }
        }
    }

    if (confirmDeploy && project != null) {
        DeployConfirmSheet(
            project = project,
            busy = state.deploying,
            onDismiss = { confirmDeploy = false },
            onConfirm = { msg ->
                actions.onDeploy(msg)
                confirmDeploy = false
            },
        )
    }
    if (newFeature) {
        NewFeatureSheet(
            busy = state.creatingSpec,
            onDismiss = { newFeature = false },
            onSubmit = { t, d -> actions.onCreateSpec(t, d) { newFeature = false } },
        )
    }
    state.logs?.let { LogsSheet(it, onDismiss = actions.onCloseLogs, onAskRepair = {
        actions.onCloseLogs(); tab = 0; actions.onSend(ChipText.REPAIR)
    }) }
    state.spec?.let { SpecSheet(it, onDismiss = actions.onCloseSpec, onDecide = actions.onDecideSpec) }
}

@Composable
private fun ProjectHeader(state: ProjectUiState, onDeploy: () -> Unit) {
    val project = state.project ?: return
    val uri = LocalUriHandler.current
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusPill(project.appStatus)
            val host = hostOf(project.productionUrl)
            if (host != null) {
                Surface(
                    onClick = { runCatching { uri.openUri(project.productionUrl!!) } },
                    color = Color.Transparent,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.heightIn(min = 40.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 8.dp)) {
                        Text(host, color = DfColors.Accent, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        Text("  ↗", color = DfColors.Accent)
                    }
                }
            } else {
                Text("Pas encore en ligne", color = DfColors.InkFaint, style = MaterialTheme.typography.bodySmall)
            }
        }
        Spacer(Modifier.width(12.dp))
        Button(
            onClick = onDeploy,
            enabled = state.canDeploy,
            modifier = Modifier.heightIn(min = 48.dp),
            shape = RoundedCornerShape(14.dp),
        ) {
            when {
                state.deploying || state.latest?.isRunning == true -> {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = DfColors.OnAccent)
                    Spacer(Modifier.width(8.dp))
                    Text("Déploiement…")
                }
                else -> Text("🚀 Mettre en ligne")
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
private fun DeploysPane(state: ProjectUiState, onOpen: (Deployment) -> Unit, modifier: Modifier = Modifier) {
    LazyColumn(
        modifier = modifier,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item(key = "title") {
            Text("Dernières mises en ligne", style = MaterialTheme.typography.titleSmall, color = DfColors.InkMuted)
        }
        if (state.deployments.isEmpty()) {
            item(key = "none") {
                Text("Pas encore de mise en ligne. Le brouillon reste local.", color = DfColors.InkFaint, style = MaterialTheme.typography.bodyMedium)
            }
        }
        items(state.deployments.take(15), key = { it.uuid }) { d -> DeployRow(d, onClick = { onOpen(d) }) }
    }
}

@Composable
private fun DeployRow(d: Deployment, onClick: () -> Unit) {
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
