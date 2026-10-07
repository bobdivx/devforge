package app.jeser.devforge.ui.project

import app.jeser.devforge.data.cleanLogs
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.ContainerState
import app.jeser.devforge.data.PersonaKey
import app.jeser.devforge.data.syncLabel
import app.jeser.devforge.ui.components.PersonaAvatar
import app.jeser.devforge.ui.components.color
import app.jeser.devforge.ui.components.persona
import app.jeser.devforge.ui.components.relativeTime
import app.jeser.devforge.ui.theme.DfColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InfoSheet(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = DfColors.Surface) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            content()
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String, color: Color = DfColors.Ink, sub: String? = null) {
    Surface(color = DfColors.Card, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, DfColors.Line), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, color = DfColors.InkFaint, fontSize = 12.sp)
            Text(value, color = color, fontWeight = FontWeight.SemiBold)
            sub?.let { Text(it, color = DfColors.InkMuted, fontSize = 13.sp) }
        }
    }
}

private fun containerLabel(c: ContainerState): Pair<String, Color> = when (c.kind) {
    ContainerState.Kind.Running -> ("En marche" + (c.duration?.let { " depuis $it" } ?: "")) to DfColors.Ok
    ContainerState.Kind.Restarting -> "Redémarre…" to DfColors.Warn
    ContainerState.Kind.Paused -> "En pause" to DfColors.Warn
    ContainerState.Kind.Exited -> ("Arrêté" + (c.duration?.let { " il y a $it" } ?: "")) to DfColors.InkMuted
    ContainerState.Kind.Created -> "Créé, pas démarré" to DfColors.InkMuted
    ContainerState.Kind.Missing -> "Aucun conteneur" to DfColors.InkFaint
    ContainerState.Kind.Unknown -> "Inconnu" to DfColors.InkFaint
}

/** Historique des mises en ligne ; un toucher ouvre les logs. */
@Composable
fun DeploysSheet(state: ProjectUiState, onDismiss: () -> Unit, onOpen: (app.jeser.devforge.data.Deployment) -> Unit) {
    val uri = LocalUriHandler.current
    InfoSheet("Mises en ligne", onDismiss) {
        syncLabel(state.git)?.let { label ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, color = DfColors.InkMuted, modifier = Modifier.weight(1f))
                state.git?.sync?.htmlUrl?.let { link ->
                    TextButton(onClick = { runCatching { uri.openUri(link) } }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Voir sur GitHub ↗") }
                }
            }
        }
        if (state.deployments.isEmpty()) {
            Text("Pas encore de mise en ligne. Le brouillon reste local.", color = DfColors.InkFaint)
        }
        state.deployments.take(20).forEach { d -> DeployRow(d, onClick = { onOpen(d) }) }
    }
}

@Composable
private fun DomainRow(host: String, label: String, onOpen: () -> Unit, onCopy: () -> Unit) {
    Surface(color = DfColors.Card, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, DfColors.Line), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(host, color = DfColors.Accent, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(label, color = DfColors.InkFaint, fontSize = 12.sp)
            }
            TextButton(onClick = onCopy, modifier = Modifier.heightIn(min = 48.dp)) { Text("Copier") }
            TextButton(onClick = onOpen, modifier = Modifier.heightIn(min = 48.dp)) { Text("Ouvrir ↗") }
        }
    }
}

private fun roleOf(k: PersonaKey) = when (k) {
    PersonaKey.Braise -> "Construit ce que tu demandes"
    PersonaKey.Phare -> "Veille sur l'app"
    PersonaKey.Rustine -> "Répare quand ça casse"
    PersonaKey.Plume -> "Relit le code"
}

@Composable
private fun SectionLabel(text: String) {
    Text(text.uppercase(), color = DfColors.InkFaint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = .8.sp,
        modifier = Modifier.padding(top = 6.dp))
}

/**
 * Tout le détail de l'app dans une seule feuille : état, dernière mise en ligne (texte complet),
 * domaine / HTTPS, GitHub, brouillon, équipe.
 */
@Composable
fun DetailsSheet(
    state: ProjectUiState,
    onDismiss: () -> Unit,
    onOpenLogs: (app.jeser.devforge.data.Deployment) -> Unit,
    onHistory: () -> Unit,
) {
    val s = state.summary
    val c = state.containerState
    val uri = LocalUriHandler.current
    val clip = LocalClipboardManager.current
    InfoSheet(state.project?.name.orEmpty(), onDismiss) {
        SectionLabel("État")
        InfoRow("Statut", s.status.label, s.status.color(), s.since)
        val (cl, cc) = containerLabel(c)
        InfoRow("Conteneur", cl, cc, state.container?.message?.takeIf { it.isNotBlank() && c.exists }?.let { "Docker : $it" })
        InfoRow(
            "Contrôle de santé", s.health,
            when (s.healthOk) { true -> DfColors.Ok; false -> DfColors.Danger; null -> DfColors.InkMuted },
            relativeTime(state.checkedAt).takeIf { it.isNotEmpty() }?.let { "Vérifié $it · actualisé toutes les 10 s" },
        )

        SectionLabel("Dernière mise en ligne")
        val latest = state.latest
        if (latest == null) {
            Text("Pas encore de mise en ligne. Le brouillon reste local.", color = DfColors.InkMuted)
        } else {
            val (label, color) = deployLabel(latest)
            Surface(color = DfColors.Card, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, if (latest.isFailed) DfColors.Danger.copy(alpha = .35f) else DfColors.Line), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    // Message complet, jamais tronqué.
                    Text(latest.gitMessage?.trim()?.takeIf { it.isNotBlank() } ?: "Mise en ligne", fontWeight = FontWeight.SemiBold, lineHeight = 21.sp)
                    Text(
                        listOfNotNull(label, latest.gitSha?.take(7), relativeTime(latest.createdAt).takeIf { it.isNotEmpty() }).joinToString(" · "),
                        color = color, fontSize = 13.sp,
                    )
                    if (latest.isFailed && !latest.errorSummary.isNullOrBlank()) {
                        Text(latest.errorSummary, color = DfColors.Danger, fontSize = 13.sp)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = { onOpenLogs(latest) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Voir les logs") }
                        TextButton(onClick = onHistory, modifier = Modifier.heightIn(min = 48.dp)) { Text("Historique") }
                    }
                }
            }
        }

        SectionLabel("Domaine")
        val hosts = state.project?.productionUrl?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty()
        if (hosts.isEmpty()) {
            Text("Pas encore de domaine : l'app n'a jamais été mise en ligne.", color = DfColors.InkMuted)
        }
        val https = when (s.healthOk) { true -> "HTTPS · répond"; false -> "HTTPS · ne répond pas"; null -> "HTTPS" }
        hosts.forEach { h ->
            val url = if (h.startsWith("http")) h else "https://$h"
            DomainRow(url.removePrefix("https://").removePrefix("http://").trimEnd('/'), https, onOpen = { runCatching { uri.openUri(url) } },
                onCopy = { clip.setText(AnnotatedString(url)) })
        }
        state.preview?.previewUrl?.let { p ->
            DomainRow(p.removePrefix("https://"), if (state.preview.running) "Aperçu du brouillon (local)" else "Aperçu du brouillon · arrêté",
                onOpen = { runCatching { uri.openUri(p) } }, onCopy = { clip.setText(AnnotatedString(p)) })
        }

        val sync = syncLabel(state.git)
        val workdir = state.git?.workdir?.takeIf { it.available }
        if (sync != null || workdir != null) SectionLabel("GitHub")
        sync?.let { label ->
            Surface(color = DfColors.Card, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, DfColors.Line), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).padding(vertical = 4.dp)) {
                        Text(label.removePrefix("GitHub : ").replaceFirstChar { ch -> ch.uppercase() }, fontWeight = FontWeight.SemiBold)
                        state.git?.branch?.let { b -> Text("Branche $b", color = DfColors.InkMuted, fontSize = 13.sp) }
                    }
                    state.git?.sync?.htmlUrl?.let { link ->
                        TextButton(onClick = { runCatching { uri.openUri(link) } }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Voir ↗") }
                    }
                }
            }
        }
        workdir?.let { w ->
            InfoRow(
                "Brouillon local",
                if (w.dirty) "${w.files.size} fichier${if (w.files.size > 1) "s" else ""} modifié${if (w.files.size > 1) "s" else ""}" else "Rien en attente",
                sub = if (w.dirty) "Pas encore en ligne : publie avec « Mettre en ligne » une fois sur GitHub." else null,
            )
        }

        SectionLabel("Équipe")
        state.team.forEach { t ->
            val p = t.key.persona()
            Surface(color = DfColors.Card, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, DfColors.Line), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    PersonaAvatar(p, 40.dp)
                    Column(Modifier.weight(1f).padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("${p.displayName} ${p.emoji}", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            Box(Modifier.size(8.dp).background(t.tone.color(), CircleShape))
                            Spacer(Modifier.width(6.dp))
                            Text(t.label, color = t.tone.color(), fontSize = 13.sp, fontWeight = FontWeight.Medium)
                        }
                        Text(roleOf(t.key), color = DfColors.InkFaint, fontSize = 12.sp)
                        t.detail?.let { Text(it, color = DfColors.InkMuted, fontSize = 13.sp) }
                    }
                }
            }
        }
    }
}

@Composable
private fun SheetAction(
    icon: ImageVector,
    title: String,
    sub: String,
    onClick: () -> Unit,
    tint: Color = DfColors.Ink,
    enabled: Boolean = true,
    busy: Boolean = false,
) {
    val alpha = if (enabled) 1f else .4f
    Surface(
        onClick = onClick,
        enabled = enabled && !busy,
        color = DfColors.Card,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, DfColors.Line),
        modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).background(tint.copy(alpha = .12f * alpha), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = tint)
                else Icon(icon, contentDescription = null, tint = tint.copy(alpha = alpha), modifier = Modifier.size(22.dp))
            }
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(title, fontWeight = FontWeight.SemiBold, color = DfColors.Ink.copy(alpha = alpha))
                Text(sub, color = DfColors.InkMuted.copy(alpha = alpha), fontSize = 13.sp)
            }
        }
    }
}

/** « Plus » : actions moins fréquentes. Redémarrer et Arrêter passent toujours par une confirmation. */
@Composable
fun MoreSheet(state: ProjectUiState, actions: ProjectActions, onDismiss: () -> Unit, onSheet: (ProjectSheet) -> Unit) {
    val running = state.containerState.running
    InfoSheet("Plus d'actions", onDismiss) {
        SheetAction(
            Icons.Filled.Visibility, "Aperçu du brouillon", "Ouvre la version en cours, en local. Rien n'est publié.",
            onClick = { actions.onOpenPreview(); onDismiss() }, busy = state.previewStarting, tint = DfColors.Accent,
        )
        SheetAction(
            Icons.Filled.RestartAlt, "Redémarrer", "Relance le conteneur, sans reconstruire. Confirmation demandée.",
            onClick = { onSheet(ProjectSheet.Restart) },
            enabled = state.canControl && running, busy = state.lifecycleBusy == "restart",
        )
        if (running || state.lifecycleBusy == "stop") {
            SheetAction(
                Icons.Filled.Stop, "Arrêter", "Le site ne répond plus jusqu'au redémarrage. Confirmation demandée.",
                onClick = { onSheet(ProjectSheet.Stop) },
                enabled = state.canControl, busy = state.lifecycleBusy == "stop", tint = DfColors.Danger,
            )
        } else {
            SheetAction(
                Icons.Filled.PlayArrow, "Démarrer", "Relance l'app arrêtée.",
                onClick = { actions.onLifecycle("start"); onDismiss() },
                enabled = state.canControl && state.containerState.kind != ContainerState.Kind.Missing,
                busy = state.lifecycleBusy == "start", tint = DfColors.Ok,
            )
        }
        SheetAction(
            Icons.Filled.Info, "Détails de l'app", "État, dernière mise en ligne, domaine, GitHub, équipe.",
            onClick = { onSheet(ProjectSheet.Details) },
        )
        SheetAction(
            Icons.Filled.History, "Historique des mises en ligne", "Toutes les publications et leurs logs.",
            onClick = { onSheet(ProjectSheet.Deploys) },
        )
    }
}

/** Logs : l'app en marche (conteneur) et la dernière mise en ligne, dans un seul panneau. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RuntimeLogsSheet(state: ProjectUiState, onDismiss: () -> Unit, onRefresh: () -> Unit, onAskRepair: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var tab by rememberSaveable { mutableIntStateOf(if (state.lastFailed) 1 else 0) }
    val rt = state.runtimeLogs ?: return
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = DfColors.Surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Logs", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                if (tab == 0) TextButton(onClick = onRefresh, enabled = !rt.loading, modifier = Modifier.heightIn(min = 48.dp)) { Text("Actualiser") }
            }
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(selected = tab == 0, onClick = { tab = 0 }, shape = SegmentedButtonDefaults.itemShape(0, 2), modifier = Modifier.heightIn(min = 48.dp)) {
                    Text("L'app")
                }
                SegmentedButton(selected = tab == 1, onClick = { tab = 1 }, shape = SegmentedButtonDefaults.itemShape(1, 2), modifier = Modifier.heightIn(min = 48.dp)) {
                    Text("Dernière mise en ligne")
                }
            }
            val dl = state.logs
            if (tab == 1 && dl != null) {
                val (label, color) = deployLabel(dl.deployment)
                Text(listOfNotNull(dl.deployment.gitMessage?.lineSequence()?.firstOrNull(), label).joinToString(" · "), color = color, fontSize = 13.sp, maxLines = 2)
                dl.deployment.errorSummary?.takeIf { it.isNotBlank() }?.let { Text(it, color = DfColors.Danger, style = MaterialTheme.typography.bodySmall) }
                if (dl.deployment.isFailed) {
                    Button(
                        onClick = onAskRepair,
                        colors = ButtonDefaults.buttonColors(containerColor = DfColors.Danger, contentColor = DfColors.OnAccent),
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text("🩹 Demander à Rustine") }
                }
            }
            Box(
                Modifier.fillMaxWidth().heightIn(min = 200.dp, max = 460.dp)
                    .background(DfColors.Bg, RoundedCornerShape(12.dp))
                    .verticalScroll(rememberScrollState(), reverseScrolling = true)
                    .padding(12.dp),
            ) {
                val (loading, error, text, empty) = if (tab == 0) {
                    listOf(rt.loading, rt.error, rt.text, "Pas de logs : l'app n'a encore rien écrit.")
                } else {
                    listOf(dl?.loading ?: false, dl?.error, dl?.text, if (dl == null) "Pas encore de mise en ligne." else "Pas de logs pour cette mise en ligne.")
                }
                when {
                    loading == true -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = DfColors.Accent)
                    error != null -> Text(error as String, color = DfColors.Danger)
                    (text as String?).isNullOrBlank() -> Text(empty as String, color = DfColors.InkFaint)
                    // Défilement horizontal pour les lignes de logs seulement ; les messages, eux, passent à la ligne.
                    else -> SelectionContainer(Modifier.horizontalScroll(rememberScrollState())) {
                        Text(cleanLogs((text as String).takeLast(60_000)), fontFamily = FontFamily.Monospace, fontSize = 11.sp, lineHeight = 15.sp, color = DfColors.InkMuted, softWrap = false)
                    }
                }
            }
        }
    }
}
