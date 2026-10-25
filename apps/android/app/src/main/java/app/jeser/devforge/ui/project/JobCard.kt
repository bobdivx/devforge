package app.jeser.devforge.ui.project

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.JobInfo
import app.jeser.devforge.ui.theme.DfColors

val JOB_STATUS_LABEL = mapOf(
    "queued" to "En file",
    "running" to "En cours",
    "paused" to "En pause",
    "done" to "Terminé",
    "failed" to "Échec",
    "cancelled" to "Arrêté",
)

private fun jobTone(status: String): Color = when (status) {
    "done" -> DfColors.Ok
    "failed" -> DfColors.Danger
    "cancelled" -> DfColors.InkFaint
    "paused" -> DfColors.InkMuted
    "queued" -> DfColors.Warn
    else -> DfColors.Accent
}

/** Carte compacte d'un job en arrière-plan (worker délégué, mise en ligne), comme sur le web. */
@Composable
fun JobCardRow(job: JobInfo, onCancel: () -> Unit, onControl: (String) -> Unit = {}) {
    val tone = jobTone(job.status)
    Surface(
        color = DfColors.Card,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, tone.copy(alpha = .35f)),
        modifier = Modifier.fillMaxWidth().testTag("job-card"),
    ) {
        Column(Modifier.padding(start = 12.dp, end = 4.dp, top = 10.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (job.live) {
                    CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 2.dp, color = tone)
                } else {
                    Box(Modifier.size(10.dp).background(tone, CircleShape))
                }
                Text(
                    job.title, fontWeight = FontWeight.Medium, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(start = 8.dp, end = 8.dp),
                )
            }
            val step = job.milestones.lastOrNull { it.status == "running" } ?: job.milestones.lastOrNull()
            val meta = listOfNotNull(
                (if (job.kind == "deploy") "Mise en ligne" else "Worker") + " · " + (JOB_STATUS_LABEL[job.status] ?: job.status),
                step?.label?.takeIf { job.live },
            ).joinToString(" · ")
            Text(meta, color = tone, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = 8.dp))
            if (!job.live && !job.summary.isNullOrBlank()) {
                Text(job.summary, color = DfColors.InkMuted, fontSize = 13.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = 8.dp))
            }
            if (job.files > 0) Text("${job.files} fichier${if (job.files > 1) "s" else ""} modifié${if (job.files > 1) "s" else ""}", color = DfColors.InkFaint, fontSize = 12.sp)
            if (job.kind == "worker" && (job.live || job.paused || job.status == "failed")) {
                Row(Modifier.align(Alignment.End), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    when {
                        job.live -> TextButton(onClick = { onControl("pause") }, modifier = Modifier.heightIn(min = 48.dp).testTag("job-pause")) {
                            Text("Pause", color = DfColors.InkMuted)
                        }
                        job.paused -> TextButton(onClick = { onControl("resume") }, modifier = Modifier.heightIn(min = 48.dp).testTag("job-resume")) {
                            Text("Reprendre", color = DfColors.Accent)
                        }
                        else -> TextButton(onClick = { onControl("retry") }, modifier = Modifier.heightIn(min = 48.dp).testTag("job-retry")) {
                            Text("Relancer", color = DfColors.Accent)
                        }
                    }
                    if (job.live) {
                        TextButton(onClick = onCancel, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text("Arrêter", color = DfColors.Danger)
                        }
                    }
                }
            }
        }
    }
}
