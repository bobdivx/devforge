package app.jeser.devforge.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.ui.theme.DfColors

/** Ce qu'une action impactante demande de confirmer. */
data class ConfirmSpec(
    val emoji: String,
    val title: String,
    val body: String,
    val confirmLabel: String,
    val danger: Boolean = false,
    val note: String? = null,
)

fun stopConfirm(appName: String, host: String?) = ConfirmSpec(
    emoji = "⏹️",
    title = "Arrêter $appName ?",
    body = (host?.let { "$it ne répondra plus" } ?: "L'app ne répondra plus") +
        " jusqu'à ce que tu la redémarres. Les données et la configuration sont gardées.",
    confirmLabel = "Arrêter",
    danger = true,
)

fun restartConfirm(appName: String) = ConfirmSpec(
    emoji = "🔄",
    title = "Redémarrer $appName ?",
    body = "Le conteneur redémarre : quelques secondes d'indisponibilité. Rien n'est reconstruit ni publié.",
    confirmLabel = "Redémarrer",
)

/** Feuille de confirmation commune (Arrêter, Redémarrer…). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfirmActionSheet(spec: ConfirmSpec, busy: Boolean, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = sheet, containerColor = DfColors.Surface) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(spec.emoji, fontSize = 28.sp)
                Spacer(Modifier.width(12.dp))
                Text(spec.title, style = MaterialTheme.typography.titleLarge)
            }
            Text(spec.body, color = DfColors.InkMuted)
            spec.note?.let { Text(it, color = DfColors.InkFaint, style = MaterialTheme.typography.bodySmall) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                OutlinedButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text("Annuler") }
                Button(
                    onClick = onConfirm,
                    enabled = !busy,
                    colors = if (spec.danger) ButtonDefaults.buttonColors(containerColor = DfColors.Danger, contentColor = DfColors.OnAccent)
                    else ButtonDefaults.buttonColors(),
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                ) {
                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = DfColors.OnAccent)
                    else Text(spec.confirmLabel)
                }
            }
        }
    }
}
