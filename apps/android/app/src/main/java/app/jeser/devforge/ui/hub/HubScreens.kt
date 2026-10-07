package app.jeser.devforge.ui.hub

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.Conversation
import app.jeser.devforge.data.InboxEvent
import app.jeser.devforge.data.Me
import app.jeser.devforge.notify.NotifKind
import app.jeser.devforge.ui.apps.personaFor
import app.jeser.devforge.ui.components.AppIcon
import app.jeser.devforge.ui.components.Persona
import app.jeser.devforge.ui.components.PersonaAvatar
import app.jeser.devforge.ui.components.PersonaMessage
import app.jeser.devforge.ui.components.relativeTime
import app.jeser.devforge.ui.theme.DfColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TabScaffold(title: String, content: @Composable (PaddingValues) -> Unit) {
    Scaffold(
        containerColor = DfColors.Bg,
        topBar = { TopAppBar(title = { Text(title) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = DfColors.Bg)) },
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { padding -> content(padding) }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text.uppercase(), color = DfColors.InkFaint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = .8.sp,
        modifier = Modifier.padding(top = 8.dp, bottom = 2.dp))
}

@Composable
private fun Card(onClick: (() -> Unit)? = null, tone: Color? = null, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    val border = BorderStroke(1.dp, tone?.copy(alpha = .3f) ?: DfColors.Line)
    val inner: @Composable () -> Unit = { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp), content = content) }
    if (onClick != null) {
        Surface(onClick = onClick, color = DfColors.Card, shape = shape, border = border, modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp)) { inner() }
    } else {
        Surface(color = DfColors.Card, shape = shape, border = border, modifier = Modifier.fillMaxWidth()) { inner() }
    }
}

private fun listPadding(padding: PaddingValues, side: Dp = 16.dp) =
    PaddingValues(start = side, end = side, top = padding.calculateTopPadding() + 4.dp, bottom = 24.dp)

/* ---------------- Braise ---------------- */

private fun waitingLabel(c: Conversation): Pair<String, Color>? = when (c.waiting) {
    "spec" -> "Spec à valider" + (c.specTitle?.let { " · « $it »" } ?: "") to DfColors.Warn
    "plan" -> "Plan prêt : à lancer en brouillon" to DfColors.Accent
    "question" -> "Braise te pose une question" to DfColors.Accent
    else -> null
}

/** Conversations avec Braise, celles qui attendent ta réponse en premier. Un toucher ouvre le chat de l'app. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BraiseScreen(state: HubUiState, onRefresh: () -> Unit, onOpen: (String) -> Unit) {
    TabScaffold("Braise 🔥") { padding ->
        PullToRefreshBox(isRefreshing = false, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
            val waiting = state.waiting
            val others = state.conversations.filter { it.waiting == null }
            LazyColumn(contentPadding = listPadding(padding), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
                when {
                    state.conversationsLoading -> item { Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = DfColors.Accent) } }
                    state.conversationsError != null && state.conversations.isEmpty() -> item {
                        PersonaMessage(Persona.Phare, "Instance injoignable", state.conversationsError, action = "Réessayer", onAction = onRefresh)
                    }
                    else -> {
                        if (waiting.isEmpty()) {
                            item(key = "calm") {
                                Card {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        PersonaAvatar(Persona.Braise, 44.dp)
                                        Column(Modifier.padding(start = 12.dp)) {
                                            Text("Rien ne t'attend", fontWeight = FontWeight.SemiBold)
                                            Text("Braise te fait signe ici dès qu'elle a besoin d'un OK ou d'une réponse.", color = DfColors.InkMuted, fontSize = 13.sp)
                                        }
                                    }
                                }
                            }
                        } else {
                            item(key = "h-wait") { SectionTitle("En attente de toi · ${waiting.size}") }
                            items(waiting, key = { "w:" + it.projectUuid }) { ConversationCard(it, onOpen) }
                        }
                        if (others.isNotEmpty()) {
                            item(key = "h-recent") { SectionTitle("Conversations récentes") }
                            items(others, key = { "o:" + it.projectUuid }) { ConversationCard(it, onOpen) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ConversationCard(c: Conversation, onOpen: (String) -> Unit) {
    val w = waitingLabel(c)
    Card(onClick = { onOpen(c.projectUuid) }, tone = w?.second) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AppIcon(c.projectName, c.productionUrl, c.gitRepository, status = null, size = 40.dp)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(c.projectName, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    relativeTime(c.createdAt).takeIf { it.isNotEmpty() }?.let {
                        Text(" · $it", color = DfColors.InkFaint, fontSize = 12.sp, maxLines = 1)
                    }
                }
                when {
                    w != null -> Text(w.first, color = w.second, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    c.working -> Text("Braise travaille…", color = DfColors.Warn, fontSize = 13.sp)
                }
                if (c.excerpt.isNotBlank()) {
                    Text(
                        (if (c.lastRole == "user") "Toi : " else "") + c.excerpt,
                        color = DfColors.InkMuted, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/* ---------------- Alertes ---------------- */

/** Historique des 7 derniers jours : échecs de mise en ligne, apps en panne, specs en attente. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AlertsScreen(state: HubUiState, onRefresh: () -> Unit, onOpen: (String) -> Unit) {
    TabScaffold("Alertes") { padding ->
        PullToRefreshBox(isRefreshing = false, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
            LazyColumn(contentPadding = listPadding(padding), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
                when {
                    state.alertsLoading -> item { Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = DfColors.Accent) } }
                    state.alertsError != null && state.alerts.isEmpty() -> item {
                        PersonaMessage(Persona.Phare, "Instance injoignable", state.alertsError, action = "Réessayer", onAction = onRefresh)
                    }
                    state.alerts.isEmpty() -> item {
                        PersonaMessage(Persona.Phare, "Rien à signaler", "Aucune alerte ces 7 derniers jours. Phare 🗼 veille sur tes apps.")
                    }
                    else -> {
                        item(key = "h") { SectionTitle("7 derniers jours") }
                        items(state.alerts, key = { it.id }) { e -> AlertCard(e, onOpen) }
                    }
                }
            }
        }
    }
}

@Composable
private fun AlertCard(e: InboxEvent, onOpen: (String) -> Unit) {
    val tone = if (e.kind == "spec_waiting") DfColors.Warn else DfColors.Danger
    Card(onClick = { onOpen(e.projectUuid) }, tone = tone) {
        Row(verticalAlignment = Alignment.Top) {
            PersonaAvatar(personaFor(e), 36.dp)
            Column(Modifier.weight(1f).padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(e.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(e.body, color = DfColors.InkMuted, fontSize = 13.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
                relativeTime(e.createdAt).takeIf { it.isNotEmpty() }?.let { Text(it, color = DfColors.InkFaint, fontSize = 12.sp) }
            }
        }
    }
}

/* ---------------- Réglages ---------------- */

@Composable
private fun InitialsAvatar(text: String, size: Dp) {
    Box(
        Modifier.size(size).background(Brush.linearGradient(listOf(DfColors.Accent, DfColors.Accent2)), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = DfColors.OnAccent, fontWeight = FontWeight.Bold, fontSize = (size.value * .38f).sp)
    }
}

private fun initialsOf(me: Me?): String {
    val base = me?.name?.takeIf { it.isNotBlank() } ?: me?.email?.substringBefore('@') ?: "?"
    val words = base.split(' ', '.', '-', '_').filter { it.isNotBlank() }
    return (if (words.size >= 2) "${words[0].first()}${words[1].first()}" else base.take(2)).uppercase()
}

/** Réglages : compte, types de notifications, version (+ mise à jour), à propos, déconnexion. */
@Composable
fun SettingsScreen(
    state: HubUiState,
    me: Me?,
    onToggle: (String, Boolean) -> Unit,
    onOpenSystemNotif: () -> Unit,
    onUpdate: () -> Unit,
    onOpenWeb: () -> Unit,
    onSignOut: () -> Unit,
) {
    var confirmOut by remember { mutableStateOf(false) }
    TabScaffold("Réglages") { padding ->
        LazyColumn(contentPadding = listPadding(padding), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
            item(key = "account") {
                SectionTitle("Compte")
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        InitialsAvatar(initialsOf(me), 48.dp)
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text(me?.name?.takeIf { it.isNotBlank() } ?: me?.email ?: "Connecté", fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            me?.email?.takeIf { me.name?.isNotBlank() == true }?.let { Text(it, color = DfColors.InkMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                            state.instance?.let { Text(it.removePrefix("https://"), color = DfColors.InkFaint, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        }
                    }
                }
            }
            item(key = "notif") {
                SectionTitle("Notifications")
                Card {
                    if (!state.systemNotifOk) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Les notifications sont coupées pour DevForge sur ce téléphone.", color = DfColors.Warn, fontSize = 13.sp, modifier = Modifier.weight(1f))
                            TextButton(onClick = onOpenSystemNotif, modifier = Modifier.heightIn(min = 48.dp)) { Text("Autoriser") }
                        }
                        HorizontalDivider(color = DfColors.Line)
                    }
                    NotifKind.entries.forEachIndexed { i, k ->
                        if (i > 0) HorizontalDivider(color = DfColors.Line)
                        val on = state.notif[k.key] ?: true
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 56.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(k.title, fontWeight = FontWeight.Medium)
                                Text(k.description, color = DfColors.InkMuted, fontSize = 12.5.sp)
                            }
                            Switch(
                                checked = on,
                                onCheckedChange = { onToggle(k.key, it) },
                                colors = SwitchDefaults.colors(checkedTrackColor = DfColors.Accent, checkedThumbColor = DfColors.OnAccent, uncheckedTrackColor = DfColors.Surface2),
                            )
                        }
                    }
                    Text("Vérifié toutes les 15 minutes environ, sans service tiers.", color = DfColors.InkFaint, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                }
            }
            item(key = "app") {
                SectionTitle("L'app")
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Version ${state.appVersion}", fontWeight = FontWeight.Medium)
                            Text(
                                when {
                                    state.updateAvailable -> "Nouvelle version ${state.android?.version} disponible"
                                    state.android?.available == true -> "À jour"
                                    else -> "Vérification de la version…"
                                },
                                color = if (state.updateAvailable) DfColors.Accent else DfColors.InkMuted,
                                fontSize = 13.sp,
                            )
                        }
                    }
                    if (state.updateAvailable) {
                        Button(onClick = onUpdate, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(top = 6.dp)) {
                            Icon(Icons.Filled.SystemUpdate, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Mettre à jour l'app")
                        }
                        Text("Télécharge le nouvel APK depuis ton instance, puis ouvre-le pour l'installer.", color = DfColors.InkFaint, fontSize = 12.sp)
                    }
                }
            }
            item(key = "about") {
                SectionTitle("À propos")
                Card {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Row(horizontalArrangement = Arrangement.spacedBy((-8).dp)) {
                            listOf(Persona.Braise, Persona.Phare, Persona.Rustine, Persona.Plume).forEach { PersonaAvatar(it, 30.dp) }
                        }
                        Text("DevForge pour Android", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 12.dp))
                    }
                    Text("Pilote tes apps et parle à Braise depuis ton téléphone. Rien n'est publié sans ton feu vert.", color = DfColors.InkMuted, fontSize = 13.sp)
                    TextButton(onClick = onOpenWeb, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text("Ouvrir DevForge sur le web")
                        Spacer(Modifier.width(6.dp))
                        Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
                    }
                }
            }
            item(key = "out") {
                OutlinedButton(
                    onClick = { confirmOut = true },
                    border = BorderStroke(1.dp, DfColors.Danger.copy(alpha = .4f)),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = DfColors.Danger),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(top = 8.dp),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Se déconnecter")
                }
            }
        }
    }
    if (confirmOut) {
        AlertDialog(
            onDismissRequest = { confirmOut = false },
            title = { Text("Se déconnecter ?") },
            text = { Text("Tu devras te reconnecter avec « Se connecter ». Les notifications s'arrêtent.") },
            confirmButton = { TextButton(onClick = { confirmOut = false; onSignOut() }) { Text("Se déconnecter", color = DfColors.Danger) } },
            dismissButton = { TextButton(onClick = { confirmOut = false }) { Text("Annuler") } },
            containerColor = DfColors.Surface,
        )
    }
}
