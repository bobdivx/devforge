package app.jeser.devforge.ui.project

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jeser.devforge.AppGraph
import app.jeser.devforge.data.ApiClient
import app.jeser.devforge.data.DevBranch
import app.jeser.devforge.data.ProdBranch
import app.jeser.devforge.data.Project
import app.jeser.devforge.data.ProjectBranches
import app.jeser.devforge.data.githubOwnerRepo
import app.jeser.devforge.ui.theme.DfColors
import kotlinx.coroutines.launch

/** Étape de la feuille Branches (chaque changement passe par une confirmation). */
sealed interface BranchStep {
    data object Prod : BranchStep
    data class ProdConfirm(val branch: String) : BranchStep
    data object Dev : BranchStep
    data class DevConfirm(val branch: String) : BranchStep
    data object DevOff : BranchStep
}

/**
 * Section « Branches » de la feuille de détails : branche de prod et environnement dev.
 * Charge et applique via l'API ; l'affichage est dans [BranchesContent].
 */
@Composable
fun BranchesSection(project: Project, onChanged: () -> Unit = {}) {
    val projectUuid = project.uuid
    val repository = project.gitRepository
    val context = LocalContext.current
    // Hors session (aperçus, captures) : affichage depuis le projet, sans appel réseau.
    val api = remember {
        runCatching { AppGraph.get(context).takeIf { it.signedIn.value }?.api }.getOrNull()
    }
    val scope = rememberCoroutineScope()
    var data by remember(projectUuid) { mutableStateOf<ProjectBranches?>(fallbackBranches(project)) }
    var branches by remember(repository) { mutableStateOf<List<String>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var step by remember { mutableStateOf<BranchStep?>(null) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(projectUuid) {
        val a = api ?: return@LaunchedEffect
        runCatching { a.branches(projectUuid) }.onSuccess { data = it }.onFailure { error = it.message }
    }
    LaunchedEffect(repository) {
        val a = api ?: return@LaunchedEffect
        val (owner, repo) = githubOwnerRepo(repository) ?: return@LaunchedEffect
        branches = runCatching { a.githubBranches(owner, repo) }.getOrDefault(emptyList())
    }

    fun submit(block: suspend (ApiClient) -> ProjectBranches) {
        val a = api ?: return
        busy = true
        scope.launch {
            runCatching { block(a) }
                .onSuccess { data = it; step = null; error = null; onChanged() }
                .onFailure { error = it.message }
            busy = false
        }
    }

    BranchesContent(
        data = data,
        error = error,
        onChangeProd = { step = BranchStep.Prod },
        onChangeDev = { step = BranchStep.Dev },
        onDisableDev = { step = BranchStep.DevOff },
    )

    val d = data ?: return
    when (val s = step) {
        BranchStep.Prod -> BranchPickerSheet(
            title = "Branche de production",
            subtitle = "Actuelle : ${d.production.branch}",
            branches = branches,
            current = d.production.branch,
            exclude = d.dev.branch,
            onDismiss = { step = null },
            onPick = { step = BranchStep.ProdConfirm(it) },
        )
        is BranchStep.ProdConfirm -> TwoChoiceSheet(
            title = "Changer la branche de production ?",
            body = "${d.production.branch} → ${s.branch}. Le site en ligne reste sur l'ancienne branche tant que tu ne redéploies pas.",
            secondary = "Sans redéployer",
            primary = "Changer et redéployer",
            busy = busy,
            onDismiss = { step = null },
            onSecondary = { submit { c -> c.setProductionBranch(projectUuid, s.branch, redeploy = false).data } },
            onPrimary = { submit { c -> c.setProductionBranch(projectUuid, s.branch, redeploy = true).data } },
        )
        BranchStep.Dev -> BranchPickerSheet(
            title = if (d.dev.enabled) "Branche dev" else "Activer la dev",
            subtitle = "Publiée sur ${d.dev.url?.removePrefix("https://") ?: "l'URL principale préfixée par dev"}",
            branches = branches,
            current = d.dev.branch.orEmpty(),
            exclude = d.production.branch,
            onDismiss = { step = null },
            onPick = { step = BranchStep.DevConfirm(it) },
        )
        is BranchStep.DevConfirm -> TwoChoiceSheet(
            title = "Déployer la dev maintenant ?",
            body = "Branche ${s.branch} → ${d.dev.url?.removePrefix("https://").orEmpty()}. " +
                "Conteneur séparé, mêmes variables et même accès SSO que la prod.",
            secondary = "Enregistrer seulement",
            primary = "Enregistrer et déployer",
            busy = busy,
            onDismiss = { step = null },
            onSecondary = { submit { c -> c.setDevBranch(projectUuid, s.branch, deploy = false).data } },
            onPrimary = { submit { c -> c.setDevBranch(projectUuid, s.branch, deploy = true).data } },
        )
        BranchStep.DevOff -> TwoChoiceSheet(
            title = "Désactiver la dev ?",
            body = "Le conteneur dev et sa route ${d.dev.url?.removePrefix("https://").orEmpty()} sont supprimés. La prod n'est pas touchée.",
            secondary = "Annuler",
            primary = "Désactiver",
            danger = true,
            busy = busy,
            onDismiss = { step = null },
            onSecondary = { step = null },
            onPrimary = { submit { c -> c.disableDevBranch(projectUuid).data } },
        )
        null -> Unit
    }
}

/** Vue minimale tirée du projet (avant la réponse de l'API). */
fun fallbackBranches(project: Project) = ProjectBranches(
    production = ProdBranch(branch = project.gitBranch ?: "main", url = project.productionUrl),
    dev = DevBranch(
        enabled = !project.devBranch.isNullOrBlank(),
        branch = project.devBranch,
        url = project.devUrl,
    ),
    autoDeploy = project.autoDeployEnabled,
)

@Composable
private fun EnvPill(text: String, color: Color) {
    Text(
        text.uppercase(),
        color = color,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = .6.sp,
        modifier = Modifier
            .background(color.copy(alpha = .14f), RoundedCornerShape(6.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

private fun devStatusWord(status: String?): Pair<String, Color> = when (status) {
    null -> "jamais déployée" to DfColors.InkFaint
    "success" -> "en ligne" to DfColors.Ok
    "failed", "error" -> "échec" to DfColors.Danger
    "cancelled" -> "annulé" to DfColors.InkMuted
    else -> "déploiement…" to DfColors.Warn
}

/** Affichage seul (testable en capture) : prod, dev, actions. */
@Composable
fun BranchesContent(
    data: ProjectBranches?,
    error: String? = null,
    onChangeProd: () -> Unit = {},
    onChangeDev: () -> Unit = {},
    onDisableDev: () -> Unit = {},
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        error?.let { Text(it, color = DfColors.Danger, fontSize = 13.sp) }
        if (data == null) {
            if (error == null) Text("Chargement des branches…", color = DfColors.InkMuted, fontSize = 13.sp)
            return@Column
        }
        BranchRow(
            pill = { EnvPill("Prod", DfColors.Ok) },
            branch = data.production.branch,
            sub = data.production.url?.removePrefix("https://"),
            action = "Changer",
            onAction = onChangeProd,
        )
        val dev = data.dev
        if (dev.enabled) {
            val (word, color) = devStatusWord(dev.lastDeployment?.status)
            BranchRow(
                pill = { EnvPill("Dev", DfColors.Warn) },
                branch = dev.branch.orEmpty(),
                sub = listOfNotNull(dev.url?.removePrefix("https://"), word).joinToString(" · "),
                subColor = color,
                action = "Changer",
                onAction = onChangeDev,
                secondAction = "Désactiver",
                onSecondAction = onDisableDev,
            )
            Text(
                "La dev reprend les variables d'environnement et l'accès SSO de la prod." +
                    if (data.autoDeploy) " Redéployée à chaque push sur ${dev.branch}." else "",
                color = DfColors.InkFaint, fontSize = 12.sp,
            )
        } else {
            BranchRow(
                pill = { EnvPill("Dev", DfColors.InkFaint) },
                branch = "Désactivée",
                sub = dev.unsupportedReason ?: dev.url?.removePrefix("https://")?.let { "Serait publiée sur $it" },
                action = if (dev.unsupportedReason == null) "Activer" else null,
                onAction = onChangeDev,
                mono = false,
            )
        }
    }
}

@Composable
private fun BranchRow(
    pill: @Composable () -> Unit,
    branch: String,
    sub: String?,
    action: String?,
    onAction: () -> Unit,
    subColor: Color = DfColors.InkMuted,
    secondAction: String? = null,
    onSecondAction: () -> Unit = {},
    mono: Boolean = true,
) {
    Surface(color = DfColors.Card, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, DfColors.Line), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 14.dp, end = 6.dp, top = 8.dp, bottom = 4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                pill()
                Spacer(Modifier.width(8.dp))
                Text(
                    branch,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = if (mono) FontFamily.Monospace else null,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                action?.let { TextButton(onClick = onAction, modifier = Modifier.heightIn(min = 48.dp)) { Text(it) } }
            }
            sub?.let { Text(it, color = subColor, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            secondAction?.let {
                TextButton(onClick = onSecondAction, modifier = Modifier.heightIn(min = 48.dp)) { Text(it, color = DfColors.Danger) }
            } ?: Spacer(Modifier.height(4.dp))
        }
    }
}

/** Liste des branches GitHub avec recherche ; une branche tapée à la main reste possible. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BranchPickerSheet(
    title: String,
    subtitle: String,
    branches: List<String>,
    current: String,
    exclude: String?,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = DfColors.Surface) {
        BranchPickerContent(title, subtitle, branches, current, exclude, onPick)
    }
}

@Composable
fun BranchPickerContent(
    title: String,
    subtitle: String,
    branches: List<String>,
    current: String,
    exclude: String?,
    onPick: (String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val list = branches.filter { it != exclude && (query.isBlank() || it.contains(query.trim(), ignoreCase = true)) }
    val typed = query.trim()
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        Text(subtitle, color = DfColors.InkMuted, fontSize = 13.sp)
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            singleLine = true,
            placeholder = { Text("Rechercher une branche") },
            modifier = Modifier.fillMaxWidth(),
        )
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 360.dp)) {
            items(list, key = { it }) { b ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(enabled = b != current) { onPick(b) }
                        .padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(b, fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (b == current) Text("actuelle", color = DfColors.Accent, fontSize = 12.sp)
                }
                HorizontalDivider(color = DfColors.Line)
            }
            if (typed.isNotEmpty() && typed !in branches && typed != exclude) {
                item {
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable { onPick(typed) }.padding(horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) { Text("Utiliser « $typed »", color = DfColors.Accent) }
                }
            }
            if (list.isEmpty() && typed.isEmpty()) {
                item { Text("Aucune branche trouvée.", color = DfColors.InkFaint, modifier = Modifier.padding(vertical = 12.dp)) }
            }
        }
    }
}

/** Confirmation à deux issues (ex. « Sans redéployer » / « Changer et redéployer »). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TwoChoiceSheet(
    title: String,
    body: String,
    secondary: String,
    primary: String,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSecondary: () -> Unit,
    onPrimary: () -> Unit,
    danger: Boolean = false,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = sheet, containerColor = DfColors.Surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            Text(body, color = DfColors.InkMuted)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton(onClick = onSecondary, enabled = !busy, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                    Text(secondary, maxLines = 2)
                }
                Button(
                    onClick = onPrimary,
                    enabled = !busy,
                    colors = if (danger) ButtonDefaults.buttonColors(containerColor = DfColors.Danger, contentColor = DfColors.OnAccent)
                    else ButtonDefaults.buttonColors(),
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                ) {
                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = DfColors.OnAccent)
                    else Text(primary, maxLines = 2)
                }
            }
        }
    }
}
