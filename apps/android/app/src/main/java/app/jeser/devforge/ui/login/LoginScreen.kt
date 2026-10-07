package app.jeser.devforge.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.ui.components.Persona
import app.jeser.devforge.ui.components.PersonaAvatar
import app.jeser.devforge.ui.theme.DfColors

/**
 * Premier écran : logo, Braise et un seul gros bouton « Se connecter ».
 * L'adresse de l'instance est intégrée ; « Autre serveur » (auto-hébergement) reste discret et facultatif.
 */
@Composable
fun LoginScreen(
    state: LoginUiState,
    onLogin: () -> Unit,
    onToggleServer: () -> Unit,
    onUrl: (String) -> Unit,
) {
    Surface(color = DfColors.Bg, modifier = Modifier.fillMaxSize()) {
        Box(
            Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(horizontal = 28.dp, vertical = 40.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                PersonaAvatar(Persona.Braise, 112.dp)
                Text(
                    buildAnnotatedString {
                        append("Dev")
                        withStyle(SpanStyle(color = DfColors.Accent)) { append("Forge") }
                    },
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    "Braise 🔥 et son équipe veillent sur tes apps. Retrouve-les dans ta poche.",
                    color = DfColors.InkMuted,
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.bodyLarge,
                )
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = onLogin,
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    if (state.busy) {
                        CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = DfColors.OnAccent)
                    } else {
                        Text("Se connecter", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                Text(
                    if (state.waitingBrowser) "Termine la connexion dans le navigateur, puis reviens ici."
                    else "Avec ton compte habituel. C'est tout.",
                    color = DfColors.InkFaint,
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                )
                state.error?.let {
                    Surface(color = DfColors.Danger.copy(alpha = .1f), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                        Text(it, color = DfColors.Danger, modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
                    }
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Persona.entries.forEach { p ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            PersonaAvatar(p, 40.dp)
                            Text(p.displayName, fontSize = 12.sp, color = DfColors.InkMuted)
                            Text(p.job, fontSize = 11.sp, color = DfColors.InkFaint)
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                if (state.showServerField) {
                    OutlinedTextField(
                        value = state.instanceUrl,
                        onValueChange = onUrl,
                        label = { Text("Adresse du serveur") },
                        singleLine = true,
                        enabled = !state.busy,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                        keyboardActions = KeyboardActions(onGo = { onLogin() }),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = DfColors.Accent,
                            unfocusedBorderColor = DfColors.LineStrong,
                            focusedContainerColor = DfColors.Surface,
                            unfocusedContainerColor = DfColors.Surface,
                        ),
                    )
                }
                TextButton(onClick = onToggleServer, enabled = !state.busy, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(
                        if (state.showServerField) "Revenir au serveur par défaut" else "Autre serveur",
                        color = DfColors.InkFaint,
                        fontSize = 13.sp,
                    )
                }
            }
        }
    }
}
