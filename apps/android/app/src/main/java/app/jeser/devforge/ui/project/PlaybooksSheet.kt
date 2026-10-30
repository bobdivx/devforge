package app.jeser.devforge.ui.project

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.Playbook
import app.jeser.devforge.data.RunLive
import app.jeser.devforge.data.evidenceUrl
import app.jeser.devforge.data.livePills
import app.jeser.devforge.data.needsHelp
import app.jeser.devforge.data.stepStateLabel
import app.jeser.devforge.data.verdictLabel
import app.jeser.devforge.data.workerStepState
import app.jeser.devforge.ui.theme.DfColors

fun playbookVerdictTone(v: String): Color = when (v) {
    "ok" -> DfColors.Ok
    "failed" -> DfColors.Danger
    "incomplete" -> DfColors.Warn
    else -> DfColors.Accent
}

fun stepTone(state: String): Color = when (state) {
    "ok" -> DfColors.Ok
    "failed" -> DfColors.Danger
    "missing" -> DfColors.Warn
    "running" -> DfColors.Accent
    else -> DfColors.InkFaint
}

/** Feuille « Modèles » : carte live du dernier lancement, puis un bouton « Lancer » par modèle. */
@Composable
fun PlaybooksSheet(
    state: ProjectUiState,
    onDismiss: () -> Unit,
    onRun: (String, String?) -> Unit,
    onWake: () -> Unit,
) {
    DraftSheetFrame(onDismiss) {
        Text("Modèles d'agent", style = MaterialTheme.typography.titleLarge, modifier = Modifier.testTag("playbooks-sheet"))
        Text("Un bouton, trois étapes fixes, une règle.", color = DfColors.InkMuted, fontSize = 14.sp)
        ErrorBox(state.playbookError)
        state.playbookRun?.let { RunLiveCard(it, waking = state.grokWaking, wake = state.grokWake, onWake = onWake) }
        val list = state.playbooks
        if (list == null) {
            if (state.playbookError == null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = DfColors.Accent)
                    Text("Chargement…", color = DfColors.InkMuted)
                }
            }
        } else {
            list.forEach { p -> PlaybookCard(p, busy = state.playbookBusy, onRun = onRun) }
        }
    }
}

@Composable
private fun PlaybookCard(p: Playbook, busy: String?, onRun: (String, String?) -> Unit) {
    var goal by rememberSaveable(p.id) { mutableStateOf("") }
    Surface(
        color = DfColors.Surface,
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, DfColors.Line),
        modifier = Modifier.fillMaxWidth().testTag("playbook-${p.id}"),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(p.slash, color = DfColors.Accent, fontFamily = FontFamily.Monospace, fontSize = 12.sp)
            Text(p.name, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Text(p.description, color = DfColors.InkMuted, fontSize = 13.sp)
            p.steps.forEachIndexed { i, s ->
                Row(verticalAlignment = Alignment.Top) {
                    Box(Modifier.size(20.dp).background(Color.White.copy(alpha = .06f), CircleShape), contentAlignment = Alignment.Center) {
                        Text("${i + 1}", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(s, fontSize = 13.sp, modifier = Modifier.weight(1f))
                }
            }
            Surface(
                color = DfColors.Warn.copy(alpha = .06f),
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.dp, DfColors.Warn.copy(alpha = .25f)),
            ) {
                Text("Règle : ${p.rule}", fontSize = 12.sp, color = DfColors.InkMuted, modifier = Modifier.fillMaxWidth().padding(10.dp))
            }
            if (p.goalLabel.isNotBlank()) {
                OutlinedTextField(
                    value = goal,
                    onValueChange = { goal = it.replace('\n', ' ').take(300) },
                    label = { Text(p.goalLabel) },
                    placeholder = { Text(p.goalPlaceholder, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = DfColors.Accent,
                        unfocusedBorderColor = DfColors.LineStrong,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Button(
                onClick = { onRun(p.id, goal.trim().ifBlank { null }) },
                enabled = busy == null,
                colors = ButtonDefaults.buttonColors(containerColor = DfColors.Accent, contentColor = DfColors.OnAccent),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("playbook-run-${p.id}"),
            ) {
                if (busy == p.id) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = DfColors.OnAccent)
                else Text("Lancer")
            }
        }
    }
}

/** Carte live : texte d'état, étapes, workers, pastilles, journal « Montre-moi ton travail », réveil du bot. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RunLiveCard(
    live: RunLive,
    waking: Boolean,
    wake: app.jeser.devforge.data.GrokWakeResult?,
    onWake: () -> Unit,
) {
    var journal by rememberSaveable(live.runUuid) { mutableStateOf(false) }
    val uri = LocalUriHandler.current
    val tone = if (live.live) DfColors.Accent else playbookVerdictTone(live.verdict)
    Surface(
        color = DfColors.Surface,
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, tone.copy(alpha = .4f)),
        modifier = Modifier.fillMaxWidth().testTag("run-live-card"),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (live.live) CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 2.dp, color = tone)
                else Box(Modifier.size(10.dp).background(tone, CircleShape))
                Spacer(Modifier.width(8.dp))
                Text(
                    (if (live.live) "ANALYSE EN DIRECT" else verdictLabel(live.verdict).uppercase()) +
                        (live.playbook?.slash?.let { " · $it" } ?: ""),
                    fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = DfColors.InkFaint,
                )
            }
            Text(live.statusText, fontWeight = FontWeight.Medium, fontSize = 15.sp, modifier = Modifier.testTag("run-live-status"))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                livePills(live.counters).forEach { label ->
                    Surface(color = Color.White.copy(alpha = .04f), shape = RoundedCornerShape(50), border = BorderStroke(1.dp, DfColors.Line)) {
                        Text(label, fontSize = 11.sp, color = DfColors.InkMuted, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
                    }
                }
            }
            live.steps.forEach { s -> StateRow(s.label, s.state) }
            live.workers.forEach { w -> StateRow(w.title ?: w.agentName ?: "Worker", workerStepState(w.status)) }
            live.playbook?.rule?.takeIf { it.isNotBlank() }?.let {
                Text("Règle : $it", fontSize = 12.sp, color = DfColors.InkMuted)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(onClick = { journal = !journal }, modifier = Modifier.heightIn(min = 48.dp).weight(1f)) {
                    Text("Mon travail (${live.decisions.size})", maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                val help = live.needsHelp
                Button(
                    onClick = onWake,
                    enabled = !waking,
                    colors = if (help) ButtonDefaults.buttonColors(containerColor = DfColors.Accent, contentColor = DfColors.OnAccent)
                    else ButtonDefaults.buttonColors(containerColor = DfColors.Surface2, contentColor = DfColors.Ink),
                    modifier = Modifier.heightIn(min = 48.dp).weight(1f).testTag("wake-grok"),
                ) {
                    if (waking) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = DfColors.InkMuted)
                    else Text("Réveiller Grok", maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            wake?.let {
                Text(it.message, fontSize = 13.sp, color = if (it.ok) DfColors.Ok else DfColors.Danger, modifier = Modifier.testTag("wake-result"))
            }
            if (journal) {
                if (live.decisions.isEmpty()) {
                    Text("Aucune décision notée pour l'instant.", fontSize = 13.sp, color = DfColors.InkMuted)
                }
                live.decisions.forEach { d ->
                    Column(
                        Modifier.fillMaxWidth().background(Color.White.copy(alpha = .02f), RoundedCornerShape(12.dp)).padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(
                            (d.step?.let { "Étape $it · " } ?: "") + d.what,
                            fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                        )
                        Text(d.why, fontSize = 12.sp, color = DfColors.InkMuted)
                        val url = evidenceUrl(d.evidence)
                        Text(
                            d.evidence,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.5.sp,
                            color = if (url != null) DfColors.Accent else DfColors.Ink,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = if (url != null) Modifier.heightIn(min = 32.dp).clickable { runCatching { uri.openUri(url) } } else Modifier,
                        )
                        Text(stepStateLabel(if (d.outcome == "unknown") "failed" else d.outcome), fontSize = 11.sp, color = stepTone(d.outcome))
                    }
                }
            }
        }
    }
}

@Composable
private fun StateRow(label: String, state: String) {
    val c = stepTone(state)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 40.dp)
            .background(if (state == "running") DfColors.Accent.copy(alpha = .06f) else Color.Transparent, RoundedCornerShape(10.dp))
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (state == "running") CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = c)
        else Box(Modifier.size(10.dp).background(c, CircleShape))
        Spacer(Modifier.width(10.dp))
        Text(label, fontSize = 13.sp, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(stepStateLabel(state), fontSize = 11.sp, color = c)
    }
}
