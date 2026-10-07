package app.jeser.devforge.ui.apps

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.AppStatus
import app.jeser.devforge.data.InboxEvent
import app.jeser.devforge.data.Project
import app.jeser.devforge.ui.components.AppIcon
import app.jeser.devforge.ui.components.ConfirmActionSheet
import app.jeser.devforge.ui.components.DfTile
import app.jeser.devforge.ui.components.Persona
import app.jeser.devforge.ui.components.PersonaAvatar
import app.jeser.devforge.ui.components.PersonaMessage
import app.jeser.devforge.ui.components.color
import app.jeser.devforge.ui.components.relativeTime
import app.jeser.devforge.ui.components.stopConfirm
import app.jeser.devforge.ui.theme.DfColors

fun hostOf(url: String?): String? =
    url?.split(',')?.firstOrNull()?.trim()
        ?.removePrefix("https://")?.removePrefix("http://")?.trimEnd('/')?.takeIf { it.isNotBlank() }

fun personaFor(event: InboxEvent): Persona = when (event.kind) {
    "spec_waiting" -> Persona.Braise
    "deploy_failed" -> Persona.Rustine
    else -> Persona.Phare
}

/** Colonnes de la grille : 2 au téléphone, 3 à 5 sur tablette (comme HubGrid). */
fun gridColumns(width: Dp): Int = when {
    width >= 1200.dp -> 5
    width >= 840.dp -> 4
    width >= 600.dp -> 3
    else -> 2
}

/** L'interrupteur n'a de sens que pour une app déjà publiée (un conteneur existe). */
fun Project.hasContainer(): Boolean = appStatus in setOf(AppStatus.Live, AppStatus.Down, AppStatus.Stopped, AppStatus.Failed) &&
    !productionUrl.isNullOrBlank()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppsScreen(
    state: AppsUiState,
    onRefresh: () -> Unit,
    onOpen: (String) -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
    onSetRunning: (String, Boolean) -> Unit = { _, _ -> },
    onNoticeShown: () -> Unit = {},
    initialInboxOpen: Boolean = false,
    initialStopConfirm: String? = null,
) {
    var menu by remember { mutableStateOf(false) }
    var inboxOpen by rememberSaveable { mutableStateOf(initialInboxOpen) }
    var confirmStop by rememberSaveable { mutableStateOf(initialStopConfirm) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.notice) {
        state.notice?.let { snackbar.showSnackbar(it); onNoticeShown() }
    }
    Scaffold(
        modifier = modifier,
        containerColor = DfColors.Bg,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text("Tes apps") },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DfColors.Bg),
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, contentDescription = "Compte") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            state.me?.let { me ->
                                DropdownMenuItem(
                                    text = { Text(me.name?.takeIf { it.isNotBlank() } ?: me.email.orEmpty(), color = DfColors.InkMuted) },
                                    onClick = {},
                                    enabled = false,
                                )
                            }
                            DropdownMenuItem(text = { Text("Rafraîchir") }, onClick = { menu = false; onRefresh() })
                            DropdownMenuItem(text = { Text("Se déconnecter") }, onClick = { menu = false; onSignOut() })
                        }
                    }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize().padding(top = padding.calculateTopPadding()),
        ) {
            when {
                state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = DfColors.Accent)
                }
                state.projects.isEmpty() && state.error != null -> AppsError(state.error, onRefresh)
                else -> BoxWithConstraints(Modifier.fillMaxSize()) {
                    val cols = gridColumns(maxWidth)
                    val side = if (maxWidth >= 600.dp) 24.dp else 16.dp
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(cols),
                        contentPadding = PaddingValues(start = side, end = side, top = 4.dp, bottom = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        if (state.error != null) {
                            item(span = { GridItemSpan(maxLineSpan) }, key = "error") {
                                Text(state.error, color = DfColors.Danger, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        if (state.inbox.isNotEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }, key = "inbox") {
                                InboxTile(state.inbox, onClick = { inboxOpen = true })
                            }
                        }
                        if (state.projects.isEmpty()) {
                            item(span = { GridItemSpan(maxLineSpan) }, key = "empty") {
                                PersonaMessage(
                                    Persona.Braise,
                                    "Pas encore d'app",
                                    "Crée ta première app depuis le web : Braise s'occupe du reste.",
                                )
                            }
                        }
                        items(state.projects, key = { it.uuid }) { p ->
                            AppTile(
                                p,
                                busy = p.uuid in state.busy,
                                onClick = { onOpen(p.uuid) },
                                onToggle = { run -> if (run) onSetRunning(p.uuid, true) else confirmStop = p.uuid },
                            )
                        }
                        item(span = { GridItemSpan(maxLineSpan) }, key = "nav-spacer") {
                            Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
                        }
                    }
                }
            }
        }
    }

    if (inboxOpen && state.inbox.isNotEmpty()) {
        InboxSheet(state.inbox, onDismiss = { inboxOpen = false }, onOpen = { inboxOpen = false; onOpen(it) })
    }
    confirmStop?.let { uuid ->
        val p = state.projects.firstOrNull { it.uuid == uuid }
        if (p != null) {
            ConfirmActionSheet(
                stopConfirm(p.name, hostOf(p.productionUrl)),
                busy = uuid in state.busy,
                onDismiss = { confirmStop = null },
                onConfirm = { onSetRunning(uuid, false); confirmStop = null },
            )
        }
    }
}

@Composable
private fun AppsError(message: String, onRetry: () -> Unit) {
    // Colonne défilable pour garder le tirer-pour-rafraîchir actif.
    LazyVerticalGrid(columns = GridCells.Fixed(1), modifier = Modifier.fillMaxSize()) {
        item {
            PersonaMessage(Persona.Phare, "Instance injoignable", message, action = "Réessayer", onAction = onRetry,
                modifier = Modifier.padding(top = 48.dp))
        }
    }
}

/** Tuile pleine largeur « À traiter » : le détail s'ouvre dans une feuille. */
@Composable
private fun InboxTile(events: List<InboxEvent>, onClick: () -> Unit) {
    val urgent = events.any { it.kind != "spec_waiting" }
    val tone = if (urgent) DfColors.Danger else DfColors.Warn
    Surface(
        onClick = onClick,
        color = tone.copy(alpha = .08f),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, tone.copy(alpha = .3f)),
        modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(horizontalArrangement = Arrangement.spacedBy((-10).dp)) {
                events.map { personaFor(it) }.distinct().take(3).forEach { PersonaAvatar(it, 34.dp) }
            }
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(
                    if (events.size > 1) "${events.size} choses à traiter" else "1 chose à traiter",
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    events.first().title,
                    color = DfColors.InkMuted,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text("Voir", color = tone, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 8.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InboxSheet(events: List<InboxEvent>, onDismiss: () -> Unit, onOpen: (String) -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = DfColors.Surface) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("À traiter", style = MaterialTheme.typography.titleLarge)
            events.forEach { ev ->
                val tone = if (ev.kind == "spec_waiting") DfColors.Warn else DfColors.Danger
                Surface(
                    onClick = { onOpen(ev.projectUuid) },
                    color = DfColors.Card,
                    shape = RoundedCornerShape(16.dp),
                    border = BorderStroke(1.dp, tone.copy(alpha = .3f)),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
                ) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        PersonaAvatar(personaFor(ev), 36.dp)
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text(ev.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(ev.body, color = DfColors.InkMuted, style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            relativeTime(ev.createdAt).takeIf { it.isNotEmpty() }?.let {
                                Text(it, color = DfColors.InkFaint, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Tuile d'app : icône, nom, statut réel, domaine, et un seul interrupteur (en marche / arrêtée). */
@Composable
fun AppTile(project: Project, busy: Boolean, onClick: () -> Unit, onToggle: (Boolean) -> Unit) {
    val status = project.appStatus
    val host = hostOf(project.productionUrl)
    DfTile(onClick = onClick, minHeight = 212.dp) {
        AppIcon(project.name, project.productionUrl, project.gitRepository, status, size = 60.dp)
        Text(
            project.name,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
        Text(status.label, color = status.color(), fontSize = 12.5.sp, fontWeight = FontWeight.Medium, maxLines = 1)
        Text(
            host ?: "Brouillon local",
            color = DfColors.InkFaint,
            fontSize = 11.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
        // Emplacement fixe de l'interrupteur : toutes les tuiles gardent la même hauteur.
        Box(Modifier.size(width = 64.dp, height = 48.dp), contentAlignment = Alignment.Center) {
            if (project.hasContainer()) {
                val on = status != AppStatus.Stopped
                if (busy) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = DfColors.Accent)
                } else {
                    // Le Switch consomme le toucher : il n'ouvre jamais la tuile.
                    Switch(
                        checked = on,
                        onCheckedChange = { onToggle(it) },
                        colors = SwitchDefaults.colors(
                            checkedTrackColor = DfColors.Ok.copy(alpha = .85f),
                            checkedThumbColor = DfColors.Bg,
                            uncheckedTrackColor = DfColors.Surface2,
                        ),
                        modifier = Modifier.semantics {
                            contentDescription = if (on) "Arrêter ${project.name}" else "Démarrer ${project.name}"
                            stateDescription = if (on) "En marche" else "Arrêtée"
                        },
                    )
                }
            }
        }
    }
}

