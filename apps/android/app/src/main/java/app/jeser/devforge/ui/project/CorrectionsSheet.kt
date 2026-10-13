package app.jeser.devforge.ui.project

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.History
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.Correction
import app.jeser.devforge.data.CorrectionStep
import app.jeser.devforge.data.CorrectionsState
import app.jeser.devforge.ui.theme.DfColors

/** Couleur d'une étape de correction. */
fun correctionTone(stage: String): Color = when (stage) {
    "proposed" -> DfColors.Warn
    "live" -> DfColors.Ok
    "failed", "conflict" -> DfColors.Danger
    "deploying" -> DfColors.Accent
    else -> DfColors.InkMuted
}

/** Libellé court pour la tuile. */
fun correctionsTileText(c: CorrectionsState?): String {
    val cur = c?.current
    if (cur != null) return "${cur.statusLabel} · ${cur.persona}"
    val last = c?.history?.firstOrNull() ?: return "Rien en attente"
    return "Dernière : ${last.statusLabel.lowercase()}"
}

@Composable
fun CorrectionStepper(steps: List<CorrectionStep>) {
    Row(Modifier.fillMaxWidth().testTag("correction-steps"), verticalAlignment = Alignment.Top) {
        steps.forEach { s ->
            val c = when (s.state) {
                "done" -> DfColors.Ok
                "failed" -> DfColors.Danger
                "active" -> DfColors.Accent
                else -> DfColors.InkFaint
            }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.size(28.dp).background(c.copy(alpha = .15f), CircleShape), contentAlignment = Alignment.Center) {
                    when (s.state) {
                        "done" -> Icon(Icons.Filled.Check, null, tint = c, modifier = Modifier.size(16.dp))
                        "failed" -> Icon(Icons.Filled.Close, null, tint = c, modifier = Modifier.size(16.dp))
                        "active" -> CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = c)
                        else -> Box(Modifier.size(8.dp).background(c, CircleShape))
                    }
                }
                Text(s.label, fontSize = 11.sp, color = DfColors.InkMuted, textAlign = TextAlign.Center, maxLines = 2,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp, start = 2.dp, end = 2.dp))
            }
        }
    }
}

@Composable
private fun Section(title: String, body: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = DfColors.InkFaint)
        body()
    }
}

/** Feuille « Corrections » : rapport de l'agent, étapes, fichiers (diff lisible), Appliquer / Rejeter. */
@Composable
fun CorrectionsSheet(
    state: ProjectUiState,
    onDismiss: () -> Unit,
    onOpenFile: (String) -> Unit,
    onApply: (() -> Unit) -> Unit,
    onReject: (() -> Unit) -> Unit,
    onRedo: (() -> Unit) -> Unit,
    onRestore: (String) -> Unit,
) {
    val data = state.corrections
    val c: Correction? = data?.current
    var confirm by rememberSaveable { mutableStateOf<String?>(null) }
    var details by rememberSaveable { mutableStateOf(false) }
    val busy = state.draftBusy != null
    val conflict = state.correctionConflict ?: c?.takeIf { it.stage == "conflict" }?.note?.ifBlank { null }
    DraftSheetFrame(onDismiss, busy = busy) {
        Text("Corrections", style = MaterialTheme.typography.titleLarge, modifier = Modifier.testTag("corrections-sheet"))
        ErrorBox(state.draftError)
        if (c == null) {
            Text("Aucune correction en attente. Quand une mise en ligne échoue, Rustine prépare et teste une correction, puis te prévient.",
                color = DfColors.InkMuted)
        } else {
            Text(buildString { append("Correction proposée par "); append(c.persona) }, color = DfColors.InkMuted, fontSize = 14.sp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(c.summary, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, modifier = Modifier.weight(1f))
                Text(c.statusLabel, color = correctionTone(c.stage), fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(start = 8.dp))
            }
            CorrectionStepper(c.steps)
            conflict?.let { ErrorBox(it) }
            val r = c.report
            if (r.broke.isNotBlank()) Section("Ce qui a cassé") { Text(r.broke, fontSize = 14.sp) }
            Section("Ce que j'ai changé") {
                Text(r.changed, fontSize = 14.sp)
                r.files.forEach { f ->
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { onOpenFile(f) }.testTag("correction-file"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.Description, null, tint = DfColors.InkFaint, modifier = Modifier.size(18.dp))
                        Text(f, fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f).padding(horizontal = 8.dp))
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Voir les changements", tint = DfColors.InkFaint)
                    }
                }
            }
            Section("Test") {
                Text(r.test, fontSize = 14.sp, color = when (r.testOk) { true -> DfColors.Ok; false -> DfColors.Danger; null -> DfColors.InkMuted })
            }
            Surface(color = Color.White.copy(alpha = .04f), shape = RoundedCornerShape(12.dp)) {
                Column(Modifier.fillMaxWidth().padding(10.dp)) {
                    Section("Ce que tu dois faire") { Text(r.todo, fontWeight = FontWeight.Medium, fontSize = 14.sp) }
                }
            }
            c.message?.takeIf { it.isNotBlank() }?.let { msg ->
                TextButton(onClick = { details = !details }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(if (details) "Masquer les détails" else "Détails", fontSize = 13.sp, color = DfColors.InkFaint)
                }
                if (details) Text(msg, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = DfColors.InkMuted)
            }
            val canAct = c.stage == "proposed" || c.stage == "conflict" || c.stage == "testing"
            if (canAct) {
                if (confirm != null) {
                    Text(
                        when (confirm) {
                            "apply" -> "Appliquer cette correction et mettre l'app en ligne ?"
                            "reject" -> "Rejeter cette correction ? Elle reste récupérable 7 jours."
                            else -> "Laisser Rustine refaire la correction sur le code à jour ?"
                        },
                        fontSize = 14.sp,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = { confirm = null }, enabled = !busy, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Annuler") }
                        Button(
                            onClick = {
                                val done = { confirm = null; onDismiss() }
                                when (confirm) {
                                    "apply" -> onApply(done)
                                    "reject" -> onReject(done)
                                    else -> onRedo(done)
                                }
                            },
                            enabled = !busy,
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("correction-confirm"),
                        ) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Confirmer") }
                    }
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = { confirm = "reject" }, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("correction-reject")) { Text("Rejeter") }
                        if (conflict != null) {
                            Button(onClick = { confirm = "redo" }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Laisser Rustine refaire", maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        } else {
                            Button(onClick = { confirm = "apply" }, enabled = c.stage != "testing",
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("correction-apply")) { Text("Appliquer") }
                        }
                    }
                }
            }
        }
        val history = data?.history.orEmpty()
        if (history.isNotEmpty()) {
            Text("HISTORIQUE", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = DfColors.InkFaint, modifier = Modifier.padding(top = 4.dp))
            history.forEach { h ->
                Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(h.statusLabel, color = correctionTone(h.stage), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(84.dp))
                    Text(h.summary, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    if (h.restorable && c == null && h.backupId != null) {
                        IconButton(onClick = { onRestore(h.backupId) }, modifier = Modifier.size(48.dp)) {
                            Icon(Icons.Filled.History, contentDescription = "Remettre cette correction")
                        }
                    }
                }
            }
        }
    }
}
