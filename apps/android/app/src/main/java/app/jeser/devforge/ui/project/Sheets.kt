package app.jeser.devforge.ui.project

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.data.Project
import app.jeser.devforge.ui.apps.hostOf
import app.jeser.devforge.ui.components.Persona
import app.jeser.devforge.ui.components.PersonaAvatar
import app.jeser.devforge.ui.markdown.MarkdownText
import app.jeser.devforge.ui.theme.DfColors

@Composable
private fun SheetColumn(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) { content() }
}

@Composable
private fun sheetFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = DfColors.Accent,
    unfocusedBorderColor = DfColors.LineStrong,
    focusedContainerColor = DfColors.Surface,
    unfocusedContainerColor = DfColors.Surface,
)

fun shortRepo(url: String?): String? =
    url?.removePrefix("https://")?.removePrefix("github.com/")?.removeSuffix(".git")?.takeIf { it.isNotBlank() }

/** Confirmation explicite avant toute mise en ligne. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeployConfirmSheet(project: Project, busy: Boolean, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = sheet, containerColor = DfColors.Surface) {
        SheetColumn {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("🚀", fontSize = 28.sp)
                Spacer(Modifier.width(12.dp))
                Text("Mettre ${project.name} en ligne ?", style = MaterialTheme.typography.titleLarge)
            }
            Text(
                "DevForge reconstruit l’app depuis GitHub puis remplace la version en ligne" +
                    (hostOf(project.productionUrl)?.let { " sur $it." } ?: "."),
                color = DfColors.InkMuted,
            )
            shortRepo(project.gitRepository)?.let { repo ->
                Text(
                    "Source : $repo" + (project.gitBranch?.let { " · branche $it" } ?: ""),
                    color = DfColors.InkMuted,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Text(
                "Les changements du brouillon qui ne sont pas encore sur GitHub ne seront pas inclus.",
                color = DfColors.InkFaint,
                style = MaterialTheme.typography.bodySmall,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                OutlinedButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text("Annuler") }
                Button(
                    onClick = { onConfirm("Mise en ligne depuis l'app Android") },
                    enabled = !busy,
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                ) {
                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = DfColors.OnAccent)
                    else Text("🚀 Mettre en ligne")
                }
            }
        }
    }
}

/** ✨ Nouvelle fonctionnalité : Braise écrit une spec, rien n'est construit avant « Approuver ». */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewFeatureSheet(busy: Boolean, onDismiss: () -> Unit, onSubmit: (String, String) -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var desc by rememberSaveable { mutableStateOf("") }
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = sheet, containerColor = DfColors.Surface) {
        SheetColumn {
            Row(verticalAlignment = Alignment.CenterVertically) {
                PersonaAvatar(Persona.Braise, 40.dp)
                Spacer(Modifier.width(12.dp))
                Column {
                    Text("Nouvelle fonctionnalité", style = MaterialTheme.typography.titleLarge)
                    Text("Braise écrit la spec. Tu la relis avant qu'elle construise.", color = DfColors.InkMuted, style = MaterialTheme.typography.bodySmall)
                }
            }
            OutlinedTextField(
                value = title, onValueChange = { title = it }, label = { Text("En quelques mots") },
                placeholder = { Text("Ex. Page de contact") }, singleLine = true, enabled = !busy,
                modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), colors = sheetFieldColors(),
            )
            OutlinedTextField(
                value = desc, onValueChange = { desc = it }, label = { Text("Ce que tu veux (facultatif)") },
                minLines = 3, maxLines = 8, enabled = !busy,
                modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), colors = sheetFieldColors(),
            )
            Button(
                onClick = { onSubmit(title, desc) },
                enabled = !busy && title.isNotBlank(),
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            ) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = DfColors.OnAccent)
                else Text("Écrire la spec")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LogsSheet(state: LogsState, onDismiss: () -> Unit, onAskRepair: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val (label, color) = deployLabel(state.deployment)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = DfColors.Surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(state.deployment.gitMessage?.lineSequence()?.firstOrNull() ?: "Mise en ligne", style = MaterialTheme.typography.titleMedium)
            Text(label, color = color, fontWeight = FontWeight.SemiBold)
            state.deployment.errorSummary?.takeIf { it.isNotBlank() }?.let { Text(it, color = DfColors.Danger, style = MaterialTheme.typography.bodySmall) }
            state.deployment.errorHint?.takeIf { it.isNotBlank() }?.let { Text(it, color = DfColors.InkMuted, style = MaterialTheme.typography.bodySmall) }
            if (state.deployment.isFailed) {
                Button(
                    onClick = onAskRepair,
                    colors = ButtonDefaults.buttonColors(containerColor = DfColors.Danger, contentColor = DfColors.OnAccent),
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("🩹 Demander à Rustine") }
            }
            Box(
                Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 460.dp)
                    .background(DfColors.Bg, RoundedCornerShape(12.dp))
                    .verticalScroll(rememberScrollState())
                    .horizontalScroll(rememberScrollState())
                    .padding(12.dp),
            ) {
                when {
                    state.loading -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = DfColors.Accent)
                    state.error != null -> Text(state.error, color = DfColors.Danger)
                    state.text.isNullOrBlank() -> Text("Pas de logs pour cette mise en ligne.", color = DfColors.InkFaint)
                    else -> SelectionContainer {
                        Text(state.text.takeLast(60_000), fontFamily = FontFamily.Monospace, fontSize = 11.sp, lineHeight = 15.sp, color = DfColors.InkMuted)
                    }
                }
            }
        }
    }
}

/** Relecture de la spec : seuls ces boutons valident (« oui » / « go » dans le chat ne suffisent pas). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpecSheet(state: SpecState, onDismiss: () -> Unit, onDecide: (Boolean) -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = { if (!state.deciding) onDismiss() }, sheetState = sheet, containerColor = DfColors.Surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                PersonaAvatar(Persona.Braise, 36.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(state.feature.title.ifBlank { state.feature.slug }, style = MaterialTheme.typography.titleMedium)
                    Text(
                        if (state.feature.awaitingValidation) "Braise attend ton OK pour construire (en local)." else "Phase : ${state.feature.phase}",
                        color = DfColors.InkMuted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            Box(
                Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 420.dp)
                    .background(DfColors.Bg, RoundedCornerShape(12.dp))
                    .verticalScroll(rememberScrollState())
                    .padding(14.dp),
            ) {
                when {
                    state.loading -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = DfColors.Accent)
                    state.markdown.isNullOrBlank() -> Text("Spec vide.", color = DfColors.InkFaint)
                    else -> MarkdownText(state.markdown)
                }
            }
            state.error?.let { Text(it, color = DfColors.Danger, style = MaterialTheme.typography.bodySmall) }
            if (state.feature.awaitingValidation) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(onClick = { onDecide(false) }, enabled = !state.deciding, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                        Text("Refuser")
                    }
                    Button(onClick = { onDecide(true) }, enabled = !state.deciding && !state.loading, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                        if (state.deciding) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = DfColors.OnAccent)
                        else Text("Approuver")
                    }
                }
                Text("Approuver lance la construction en brouillon. Rien n'est mis en ligne.", color = DfColors.InkFaint, style = MaterialTheme.typography.bodySmall)
            } else {
                TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text("Fermer") }
            }
        }
    }
}

