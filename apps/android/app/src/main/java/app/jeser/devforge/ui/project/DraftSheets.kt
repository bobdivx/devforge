package app.jeser.devforge.ui.project

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.DraftDiffFile
import app.jeser.devforge.data.DraftFile
import app.jeser.devforge.data.DraftStatus
import app.jeser.devforge.ui.components.relativeTime
import app.jeser.devforge.ui.theme.DfColors

fun filesLabel(n: Int) = "$n fichier${if (n > 1) "s" else ""} modifié${if (n > 1) "s" else ""}"

private fun statusLabel(s: String): Pair<String, Color> = when (s) {
    "added" -> "ajouté" to DfColors.Ok
    "deleted" -> "supprimé" to DfColors.Danger
    "renamed" -> "renommé" to DfColors.Warn
    else -> "modifié" to DfColors.Accent
}

@Composable
fun DraftStatusBadge(status: String) {
    val (label, c) = statusLabel(status)
    Text(
        label,
        color = c,
        fontSize = 11.5.sp,
        fontWeight = FontWeight.Medium,
        modifier = Modifier.background(c.copy(alpha = .12f), RoundedCornerShape(8.dp)).padding(horizontal = 7.dp, vertical = 2.dp),
    )
}

/* ---------------- Bandeau ---------------- */

/** « Brouillon · N fichiers modifiés · il y a X » : n'apparaît que s'il y a un brouillon. */
@Composable
fun DraftBanner(draft: DraftStatus?, onClick: () -> Unit, modifier: Modifier = Modifier) {
    if (draft == null || !draft.available || !draft.dirty) return
    val tone = DfColors.Warn
    val whenText = relativeTime(draft.updatedAt)
    val title = "Brouillon · ${filesLabel(draft.count)}" + if (whenText.isNotBlank()) " · $whenText" else ""
    val sub = if (draft.behind > 0) "GitHub a avancé de ${draft.behind} commit${if (draft.behind > 1) "s" else ""} · à mettre à jour"
    else "Pas encore sur GitHub · valider ou supprimer"
    Surface(
        onClick = onClick,
        color = tone.copy(alpha = .07f),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, tone.copy(alpha = .28f)),
        modifier = modifier.fillMaxWidth().heightIn(min = 48.dp).semantics {
            contentDescription = "$title. $sub. Toucher pour voir et gérer."
            role = Role.Button
        },
    ) {
        Row(Modifier.padding(start = 12.dp, end = 8.dp, top = 7.dp, bottom = 7.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Description, contentDescription = null, tint = tone, modifier = Modifier.size(20.dp))
            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                Text(title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(sub, color = DfColors.InkMuted, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = DfColors.InkFaint)
        }
    }
}

/* ---------------- Feuilles ---------------- */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DraftSheetFrame(onDismiss: () -> Unit, busy: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = sheet, containerColor = DfColors.Surface) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

@Composable
private fun ErrorBox(text: String?) {
    text ?: return
    Surface(color = DfColors.Danger.copy(alpha = .1f), shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, DfColors.Danger.copy(alpha = .3f))) {
        Text(text, color = DfColors.Danger, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(12.dp))
    }
}

/** Liste des fichiers + actions Valider / Supprimer / Mettre à jour, sauvegardes restaurables. */
@Composable
fun DraftSheet(
    state: ProjectUiState,
    onDismiss: () -> Unit,
    onOpenFile: (String) -> Unit,
    onValidate: () -> Unit,
    onDiscard: () -> Unit,
    onUpdate: () -> Unit,
    onRestore: (String) -> Unit,
    onOpenPreview: () -> Unit,
) {
    val draft = state.draft
    val busy = state.draftBusy
    DraftSheetFrame(onDismiss, busy = busy != null) {
        Text(if (draft?.dirty == true) "Brouillon · ${filesLabel(draft.count)}" else "Brouillon", style = MaterialTheme.typography.titleLarge)
        Text(
            if (draft?.dirty == true) "Changements faits en local, pas encore sur GitHub (branche ${draft.branch}). L'app en ligne ne change pas."
            else "Aucun changement local en attente.",
            color = DfColors.InkMuted,
        )
        ErrorBox(state.draftError)
        if (draft?.dirty == true && draft.behind > 0) {
            Surface(color = DfColors.Accent.copy(alpha = .08f), shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, DfColors.Accent.copy(alpha = .3f))) {
                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("GitHub a ${draft.behind} commit${if (draft.behind > 1) "s" else ""} que le brouillon n'a pas. Mets à jour avant de valider.", color = DfColors.InkMuted, fontSize = 14.sp)
                    OutlinedButton(onClick = onUpdate, enabled = busy == null, modifier = Modifier.heightIn(min = 48.dp)) {
                        if (busy == "update") CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Icon(Icons.Filled.Download, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Mettre à jour depuis GitHub")
                    }
                }
            }
        }
        if (draft?.preview?.running == true) {
            Surface(onClick = onOpenPreview, color = DfColors.Card, shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, DfColors.Line), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Visibility, null, tint = DfColors.Accent, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                    Text("Voir l'aperçu du brouillon", color = DfColors.Accent, modifier = Modifier.weight(1f))
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = DfColors.InkFaint)
                }
            }
        }
        if (draft?.dirty == true) {
            Surface(color = DfColors.Card, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, DfColors.Line)) {
                Column {
                    draft.files.forEachIndexed { i, f ->
                        if (i > 0) HorizontalDivider(color = DfColors.Line)
                        DraftFileRow(f, state.draftDiff?.firstOrNull { it.path == f.path }, onClick = { onOpenFile(f.path) })
                    }
                }
            }
            state.draftDiffError?.let { Text("Diff indisponible : $it", color = DfColors.InkFaint, fontSize = 12.sp) }
        }
        if (draft != null && draft.junkCount > 0) {
            Text(
                "${draft.junkCount} fichier${if (draft.junkCount > 1) "s" else ""} technique${if (draft.junkCount > 1) "s" else ""} ignoré${if (draft.junkCount > 1) "s" else ""} (aperçu, build, secrets) : jamais envoyés.",
                color = DfColors.InkFaint, fontSize = 12.sp,
            )
        }
        if (draft?.dirty == true) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                OutlinedButton(
                    onClick = onDiscard,
                    enabled = busy == null,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = DfColors.Danger),
                    border = BorderStroke(1.dp, DfColors.Danger.copy(alpha = .4f)),
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                ) {
                    Icon(Icons.Filled.Delete, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Supprimer")
                }
                Button(
                    onClick = onValidate,
                    enabled = busy == null && draft.behind == 0 && draft.hasRemote,
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                ) {
                    Icon(Icons.Filled.CloudUpload, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Valider", fontWeight = FontWeight.SemiBold)
                }
            }
        }
        if (draft != null && draft.backups.isNotEmpty()) {
            Text("Sauvegardes (7 jours)", color = DfColors.InkMuted, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
            draft.backups.forEach { b ->
                Surface(color = DfColors.Card, shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, DfColors.Line)) {
                    Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.History, null, tint = DfColors.InkFaint, modifier = Modifier.size(18.dp))
                        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                            Text((if (b.reason == "revert-file") "Fichier annulé" else "Brouillon supprimé") + " · " + relativeTime(b.createdAt), fontSize = 14.sp)
                            val all = b.files + b.deleted
                            Text(all.take(3).joinToString(", ") + if (all.size > 3) " +${all.size - 3}" else "", color = DfColors.InkFaint, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        TextButton(onClick = { onRestore(b.id) }, enabled = busy == null, modifier = Modifier.heightIn(min = 48.dp)) { Text("Restaurer") }
                    }
                }
            }
        }
    }
}

@Composable
private fun DraftFileRow(f: DraftFile, diff: DraftDiffFile?, onClick: () -> Unit) {
    Surface(onClick = onClick, color = Color.Transparent, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
        Row(Modifier.padding(start = 14.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(f.path, fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 17.sp)
                if (diff != null && (diff.additions > 0 || diff.deletions > 0)) {
                    Text("+${diff.additions}  −${diff.deletions}", fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = DfColors.InkFaint)
                }
            }
            Spacer(Modifier.width(8.dp))
            DraftStatusBadge(f.status)
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = DfColors.InkFaint)
        }
    }
}

/** Diff lisible sur téléphone : lignes repliées, couleurs légères. */
@Composable
fun PatchView(patch: String, modifier: Modifier = Modifier) {
    val lines = remember(patch) { patch.lines().take(1500) }
    SelectionContainer {
        Column(modifier.fillMaxWidth().background(DfColors.Bg, RoundedCornerShape(12.dp)).padding(vertical = 8.dp)) {
            lines.forEach { line ->
                val (bg, fg) = when {
                    line.startsWith("+") && !line.startsWith("+++") -> DfColors.Ok.copy(alpha = .10f) to Color(0xFF86EFAC)
                    line.startsWith("-") && !line.startsWith("---") -> DfColors.Danger.copy(alpha = .10f) to Color(0xFFFDA4AF)
                    line.startsWith("@@") -> Color.Transparent to Color(0xFF7DD3FC)
                    else -> Color.Transparent to DfColors.InkMuted
                }
                Text(
                    line.ifEmpty { " " },
                    color = fg,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    softWrap = true,
                    modifier = Modifier.fillMaxWidth().background(bg).padding(horizontal = 10.dp, vertical = 1.dp),
                )
            }
        }
    }
}

/** Un fichier : diff complet + « Annuler ce fichier » (confirmation dans la feuille). */
@Composable
fun DraftFileSheet(state: ProjectUiState, path: String, onBack: () -> Unit, onDismiss: () -> Unit, onRevert: (String) -> Unit) {
    val file = state.draft?.files?.firstOrNull { it.path == path }
    val diff = state.draftDiff?.firstOrNull { it.path == path }
    var confirm by rememberSaveable(path) { mutableStateOf(false) }
    val busy = state.draftBusy
    DraftSheetFrame(onDismiss, busy = busy != null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour à la liste") }
            Text(path.substringAfterLast('/'), style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            file?.let { DraftStatusBadge(it.status) }
        }
        Text(path, fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, color = DfColors.InkFaint)
        ErrorBox(state.draftError)
        if (file != null) {
            if (confirm) {
                Surface(color = DfColors.Danger.copy(alpha = .07f), shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, DfColors.Danger.copy(alpha = .3f))) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            (if (file.status == "added") "Ce nouveau fichier sera retiré." else "Ce fichier redevient comme sur GitHub.") + " Sauvegarde gardée 7 jours.",
                            color = DfColors.InkMuted, fontSize = 14.sp,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedButton(onClick = { confirm = false }, enabled = busy == null, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Garder") }
                            Button(
                                onClick = { onRevert(path) },
                                enabled = busy == null,
                                colors = ButtonDefaults.buttonColors(containerColor = DfColors.Danger, contentColor = DfColors.OnAccent),
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                            ) {
                                if (busy == "revert") CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = DfColors.OnAccent) else Text("Annuler ce fichier")
                            }
                        }
                    }
                }
            } else {
                OutlinedButton(onClick = { confirm = true }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Icon(Icons.AutoMirrored.Filled.Undo, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Annuler ce fichier")
                }
            }
        }
        when {
            state.draftDiff == null && state.draftDiffError == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = DfColors.Accent)
            }
            !diff?.patch.isNullOrBlank() -> PatchView(diff!!.patch!!)
            else -> Text(
                if (file?.status == "deleted") "Fichier supprimé dans le brouillon." else "Pas d'aperçu (fichier binaire ou trop gros).",
                color = DfColors.InkMuted,
            )
        }
    }
}

/** « Valider » : message modifiable, puis proposition explicite de mise en ligne. */
@Composable
fun DraftValidateSheet(state: ProjectUiState, canDeploy: Boolean, onDismiss: () -> Unit, onValidate: (String) -> Unit, onDeployNow: () -> Unit) {
    val draft = state.draft
    val done = state.draftValidated
    var message by rememberSaveable { mutableStateOf(draft?.suggestedMessage.orEmpty()) }
    val busy = state.draftBusy
    DraftSheetFrame(onDismiss, busy = busy != null) {
        if (done == null) {
            Text("Valider le brouillon ?", style = MaterialTheme.typography.titleLarge)
            Text(
                "Envoie ces changements sur GitHub (branche ${draft?.branch ?: "main"}). L'app en ligne ne change pas tant que tu ne la mets pas en ligne.",
                color = DfColors.InkMuted,
            )
            ErrorBox(state.draftError)
            OutlinedTextField(
                value = message,
                onValueChange = { message = it.take(300) },
                label = { Text("Message (modifiable)") },
                minLines = 2,
                maxLines = 5,
                modifier = Modifier.fillMaxWidth(),
            )
            val files = draft?.files.orEmpty()
            Text(
                filesLabel(files.size) + " : " + files.take(4).joinToString(", ") { it.path.substringAfterLast('/') } +
                    if (files.size > 4) " et ${files.size - 4} autre${if (files.size - 4 > 1) "s" else ""}" else "",
                color = DfColors.InkMuted, fontSize = 14.sp,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                OutlinedButton(onClick = onDismiss, enabled = busy == null, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text("Annuler") }
                Button(onClick = { onValidate(message) }, enabled = busy == null && message.isNotBlank(), modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                    if (busy == "validate") CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = DfColors.OnAccent)
                    else Text("Valider et envoyer", fontWeight = FontWeight.SemiBold)
                }
            }
        } else {
            Text("C'est sur GitHub ✅", style = MaterialTheme.typography.titleLarge)
            Text(
                "${filesLabel(done.files)} envoyé${if (done.files > 1) "s" else ""} sur GitHub (commit ${done.sha.take(7)}, branche ${done.branch}).",
                color = DfColors.InkMuted,
            )
            if (canDeploy) {
                Text("Mettre en ligne maintenant ? DevForge reconstruit l'app depuis GitHub puis remplace la version en ligne.", color = DfColors.Ink)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text("Plus tard") }
                if (canDeploy) {
                    Button(onClick = onDeployNow, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                        Icon(Icons.Filled.CloudUpload, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Mettre en ligne", fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

/** « Supprimer le brouillon » : liste de ce qui sera perdu, style danger. */
@Composable
fun DraftDiscardSheet(state: ProjectUiState, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    val files = state.draft?.files.orEmpty()
    val busy = state.draftBusy
    DraftSheetFrame(onDismiss, busy = busy != null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("🗑️", fontSize = 28.sp)
            Spacer(Modifier.width(12.dp))
            Text("Supprimer le brouillon ?", style = MaterialTheme.typography.titleLarge)
        }
        Text("Le dossier de travail revient exactement à l'état de GitHub. Ces changements seront perdus :", color = DfColors.InkMuted)
        ErrorBox(state.draftError)
        Surface(color = DfColors.Danger.copy(alpha = .05f), shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, DfColors.Danger.copy(alpha = .25f))) {
            Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                files.take(30).forEach { f ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(f.path, fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, modifier = Modifier.weight(1f))
                        Spacer(Modifier.width(8.dp))
                        DraftStatusBadge(f.status)
                    }
                }
                if (files.size > 30) Text("et ${files.size - 30} autres…", color = DfColors.InkFaint, fontSize = 12.sp)
            }
        }
        Text(
            "• L'aperçu du brouillon est arrêté.\n• Une sauvegarde est gardée 7 jours (« Annuler » juste après).\n• Les dépendances installées et la version en ligne ne bougent pas.",
            color = DfColors.InkMuted, fontSize = 14.sp,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
            OutlinedButton(onClick = onDismiss, enabled = busy == null, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text("Garder") }
            Button(
                onClick = onConfirm,
                enabled = busy == null,
                colors = ButtonDefaults.buttonColors(containerColor = DfColors.Danger, contentColor = DfColors.OnAccent),
                modifier = Modifier.weight(1f).heightIn(min = 52.dp),
            ) {
                if (busy == "discard") CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = DfColors.OnAccent)
                else Text("Supprimer", fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
