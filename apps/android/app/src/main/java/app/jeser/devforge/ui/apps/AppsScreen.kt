package app.jeser.devforge.ui.apps

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.AppStatus
import app.jeser.devforge.data.InboxEvent
import app.jeser.devforge.data.Project
import app.jeser.devforge.ui.components.DfCard
import app.jeser.devforge.ui.components.Persona
import app.jeser.devforge.ui.components.PersonaAvatar
import app.jeser.devforge.ui.components.PersonaMessage
import app.jeser.devforge.ui.components.StatusPill
import app.jeser.devforge.ui.components.relativeTime
import app.jeser.devforge.ui.theme.DfColors

fun hostOf(url: String?): String? =
    url?.removePrefix("https://")?.removePrefix("http://")?.trimEnd('/')?.takeIf { it.isNotBlank() }

fun personaFor(event: InboxEvent): Persona = when (event.kind) {
    "spec_waiting" -> Persona.Braise
    "deploy_failed" -> Persona.Rustine
    else -> Persona.Phare
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppsScreen(
    state: AppsUiState,
    selectedUuid: String?,
    onRefresh: () -> Unit,
    onOpen: (String) -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var menu by remember { mutableStateOf(false) }
    Scaffold(
        modifier = modifier,
        containerColor = DfColors.Bg,
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
                else -> LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 300.dp),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    if (state.error != null) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "error") {
                            Text(state.error, color = DfColors.Danger, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    if (state.inbox.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }, key = "inbox-title") {
                            SectionTitle("À traiter")
                        }
                        items(state.inbox, key = { "inbox:" + it.id }, span = { GridItemSpan(maxLineSpan) }) { ev ->
                            InboxRow(ev, onClick = { onOpen(ev.projectUuid) })
                        }
                        item(span = { GridItemSpan(maxLineSpan) }, key = "apps-title") { SectionTitle("Apps") }
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
                        ProjectCard(p, selected = p.uuid == selectedUuid, onClick = { onOpen(p.uuid) })
                    }
                    item(span = { GridItemSpan(maxLineSpan) }, key = "nav-spacer") {
                        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = DfColors.InkMuted,
        modifier = Modifier.padding(top = 8.dp, bottom = 2.dp, start = 4.dp),
    )
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

@Composable
private fun InboxRow(event: InboxEvent, onClick: () -> Unit) {
    val tone = if (event.kind == "spec_waiting") DfColors.Accent else DfColors.Danger
    Surface(
        onClick = onClick,
        color = tone.copy(alpha = .08f),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, tone.copy(alpha = .3f)),
        modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            PersonaAvatar(personaFor(event), 36.dp)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(event.title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(event.body, color = DfColors.InkMuted, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
fun ProjectCard(project: Project, selected: Boolean, onClick: () -> Unit) {
    val status = project.appStatus
    Surface(
        onClick = onClick,
        color = if (selected) DfColors.AccentSoft else DfColors.Card,
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, if (selected) DfColors.Accent.copy(alpha = .6f) else DfColors.Line),
        modifier = Modifier.fillMaxWidth().heightIn(min = 112.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    project.name,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                StatusPill(status)
            }
            Text(
                hostOf(project.productionUrl) ?: "Pas encore en ligne",
                color = if (project.productionUrl != null) DfColors.Accent else DfColors.InkFaint,
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val last = project.deploy?.message?.lineSequence()?.firstOrNull()?.takeIf { it.isNotBlank() }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    last ?: when (status) {
                        AppStatus.Draft -> "Brouillon local, pas encore publié"
                        else -> "Aucune mise en ligne récente"
                    },
                    color = DfColors.InkMuted,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                val rel = relativeTime(project.updatedAt)
                if (rel.isNotEmpty()) {
                    Text(rel, color = DfColors.InkFaint, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 8.dp))
                }
            }
        }
    }
}

