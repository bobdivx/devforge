package app.jeser.devforge.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.jeser.devforge.ui.theme.DfColors

/** Demandé une seule fois, juste après la connexion, avant la fenêtre système d'Android 13+. */
@Composable
fun NotificationPrompt(onAccept: () -> Unit, onLater: () -> Unit) {
    AlertDialog(
        onDismissRequest = onLater,
        containerColor = DfColors.Surface,
        icon = { PersonaAvatar(Persona.Phare, 56.dp) },
        title = { Text("Je te préviens si ça coince ?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.Start) {
                Text("Phare 🗼 t'envoie une notification quand :", color = DfColors.InkMuted)
                Text("• une mise en ligne échoue ;", color = DfColors.InkMuted)
                Text("• une app ne répond plus ;", color = DfColors.InkMuted)
                Text("• Braise attend ton OK pour construire.", color = DfColors.InkMuted)
                Text("Rien d'autre. Tu pourras couper ça dans les réglages d'Android.", color = DfColors.InkFaint)
            }
        },
        confirmButton = {
            Button(onClick = onAccept, modifier = Modifier.heightIn(min = 48.dp)) { Text("Oui, préviens-moi") }
        },
        dismissButton = {
            TextButton(onClick = onLater, modifier = Modifier.heightIn(min = 48.dp)) { Text("Pas maintenant") }
        },
    )
}
