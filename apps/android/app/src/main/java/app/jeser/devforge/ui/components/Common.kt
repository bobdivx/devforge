package app.jeser.devforge.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.AppStatus
import app.jeser.devforge.ui.theme.DfColors

fun AppStatus.color(): Color = when (this) {
    AppStatus.Live -> DfColors.Ok
    AppStatus.Deploying -> DfColors.Warn
    AppStatus.Failed, AppStatus.Down -> DfColors.Danger
    AppStatus.Draft, AppStatus.Stopped -> DfColors.InkFaint
}

@Composable
fun StatusPill(status: AppStatus, modifier: Modifier = Modifier) {
    val c = status.color()
    Row(
        modifier
            .background(c.copy(alpha = .12f), RoundedCornerShape(50))
            .border(1.dp, c.copy(alpha = .3f), RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 4.dp)
            .semantics { contentDescription = "Statut : ${status.label}" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(7.dp).background(c, CircleShape))
        Text(status.label, color = c, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun DfCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(
        modifier = modifier,
        color = DfColors.Card,
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, DfColors.Line),
        content = content,
    )
}

/** État vide / erreur avec un personnage et une action. */
@Composable
fun PersonaMessage(
    persona: Persona,
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    action: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        PersonaAvatar(persona, 64.dp)
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(body, color = DfColors.InkMuted, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium)
        if (action != null && onAction != null) {
            Spacer(Modifier.height(4.dp))
            OutlinedButton(onClick = onAction, modifier = Modifier.height(48.dp)) { Text(action) }
        }
    }
}

/** Date courte et lisible (« il y a 5 min », « 12 sept. »). */
fun relativeTime(iso: String?, nowMillis: Long = System.currentTimeMillis()): String {
    if (iso.isNullOrBlank()) return ""
    val t = runCatching { java.time.OffsetDateTime.parse(iso).toInstant().toEpochMilli() }.getOrNull() ?: return ""
    val diff = (nowMillis - t) / 1000
    return when {
        diff < 45 -> "à l'instant"
        diff < 3600 -> "il y a ${diff / 60} min"
        diff < 86400 -> "il y a ${diff / 3600} h"
        diff < 7 * 86400 -> "il y a ${diff / 86400} j"
        else -> java.time.format.DateTimeFormatter.ofPattern("d MMM", java.util.Locale.FRENCH)
            .format(java.time.Instant.ofEpochMilli(t).atZone(java.time.ZoneId.systemDefault()))
    }
}
