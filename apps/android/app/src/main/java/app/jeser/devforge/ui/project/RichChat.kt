package app.jeser.devforge.ui.project

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddReaction
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.HelpOutline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.jeser.devforge.data.AnswerInfo
import app.jeser.devforge.data.AttachmentInfo
import app.jeser.devforge.data.PendingImage
import app.jeser.devforge.data.QUICK_REACTIONS
import app.jeser.devforge.data.QuestionInfo
import app.jeser.devforge.data.QuestionOption
import app.jeser.devforge.data.ReactionInfo
import app.jeser.devforge.ui.theme.DfColors
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** État riche d'une ligne du fil (calculé par le panneau). */
data class RichRowState(val questionOpen: Boolean = false, val answer: AnswerInfo? = null, val canReact: Boolean = false)

/** Réponse à une question, affichée « ✓ choix ». */
@Composable
fun AnswerBubble(a: AnswerInfo) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Surface(color = DfColors.AccentSoft, shape = RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp), border = BorderStroke(1.dp, DfColors.Accent.copy(alpha = .25f))) {
            Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp).testTag("answer-bubble"), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Check, contentDescription = null, tint = DfColors.Accent, modifier = Modifier.size(16.dp))
                Text(a.display, modifier = Modifier.padding(start = 6.dp), fontSize = 15.sp)
            }
        }
    }
}

/** Carte de question `ask_user` (P5-04) : un clic suffit, puis lecture seule. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun QuestionCardRow(q: QuestionInfo, open: Boolean, answer: AnswerInfo?, onAnswer: (QuestionOption?, String?) -> Unit) {
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    var other by rememberSaveable { mutableStateOf(false) }
    var text by rememberSaveable { mutableStateOf("") }
    val done = answer != null || picked != null || !open
    Surface(color = DfColors.Surface2, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, DfColors.LineStrong), modifier = Modifier.fillMaxWidth().testTag("question-card")) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Icon(Icons.Filled.HelpOutline, contentDescription = null, tint = DfColors.Accent, modifier = Modifier.size(18.dp).padding(top = 1.dp))
                Text(q.question, modifier = Modifier.padding(start = 8.dp), fontWeight = FontWeight.Medium, fontSize = 15.sp)
            }
            if (answer != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Check, contentDescription = null, tint = DfColors.Ok, modifier = Modifier.size(16.dp))
                    Text("Tu as choisi : ", color = DfColors.InkMuted, fontSize = 14.sp, modifier = Modifier.padding(start = 6.dp))
                    Text(answer.display, fontWeight = FontWeight.Medium, fontSize = 14.sp)
                }
            } else {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    q.options.forEach { o ->
                        val chosen = picked == o.id
                        val (bg, fg) = when (o.style) {
                            "primary" -> DfColors.Accent to DfColors.OnAccent
                            "danger" -> DfColors.Danger.copy(alpha = .15f) to DfColors.Danger
                            else -> DfColors.Surface to DfColors.Ink
                        }
                        Surface(
                            onClick = {
                                if (!done) {
                                    picked = o.id
                                    onAnswer(o, null)
                                }
                            },
                            enabled = !done,
                            shape = RoundedCornerShape(10.dp),
                            color = bg,
                            border = BorderStroke(if (chosen) 2.dp else 1.dp, if (chosen) DfColors.Accent else DfColors.LineStrong),
                            modifier = Modifier.heightIn(min = 48.dp).alpha(if (done && !chosen) .4f else 1f).testTag("question-option-${o.id}"),
                        ) {
                            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                                Text(o.label, color = fg, fontWeight = FontWeight.Medium, fontSize = 14.sp)
                                o.description?.let { Text(it, color = fg.copy(alpha = .75f), fontSize = 12.sp) }
                            }
                        }
                    }
                    if (q.allowFreeText && !done && !other) {
                        TextButton(onClick = { other = true }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Autre…") }
                    }
                }
                if (other && !done) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(value = text, onValueChange = { text = it.take(500) }, placeholder = { Text("Ta réponse…") }, singleLine = true, modifier = Modifier.weight(1f))
                        TextButton(
                            onClick = {
                                picked = "__other"
                                onAnswer(null, text)
                            },
                            enabled = text.isNotBlank(),
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text("Envoyer") }
                    }
                }
                if (!open && picked == null) Text("La conversation a continué : question sans réponse.", color = DfColors.InkFaint, fontSize = 12.sp)
            }
        }
    }
}

/** Pastilles de réactions + bouton « Réagir » (menu de 6 emojis), cibles 48 dp. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReactionsRow(reactions: List<ReactionInfo>, enabled: Boolean, onToggle: (String) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.testTag("reactions")) {
        reactions.forEach { r ->
            Surface(
                onClick = { onToggle(r.emoji) },
                enabled = enabled,
                shape = RoundedCornerShape(50),
                color = if (r.mine) DfColors.AccentSoft else DfColors.Surface,
                border = BorderStroke(1.dp, if (r.mine) DfColors.Accent.copy(alpha = .5f) else DfColors.Line),
                modifier = Modifier.semantics { contentDescription = "${r.emoji} ${r.count}${if (r.mine) ", ta réaction" else ""}" },
            ) {
                Row(Modifier.padding(horizontal = 10.dp).heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(r.emoji, fontSize = 14.sp)
                    if (r.count > 1) Text("${r.count}", fontSize = 12.sp, color = DfColors.InkMuted, modifier = Modifier.padding(start = 4.dp))
                }
            }
        }
        if (enabled) {
            Box {
                IconButton(onClick = { menu = true }, modifier = Modifier.size(48.dp).testTag("react-button")) {
                    Icon(Icons.Filled.AddReaction, contentDescription = "Réagir", tint = DfColors.InkFaint, modifier = Modifier.size(18.dp))
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = DfColors.Surface2) {
                    Row(Modifier.padding(horizontal = 6.dp)) {
                        QUICK_REACTIONS.forEach { e ->
                            Box(
                                Modifier.size(48.dp).clip(CircleShape).clickable {
                                    menu = false
                                    onToggle(e)
                                }.semantics { contentDescription = "Réagir $e" },
                                contentAlignment = Alignment.Center,
                            ) { Text(e, fontSize = 20.sp) }
                        }
                    }
                }
            }
        }
    }
}

/** Grille 1–4 images d'un message, ratio réservé ; appui = plein écran. */
@Composable
fun ImageGridRow(images: List<AttachmentInfo>, urlFor: (String) -> String?) {
    var open by remember { mutableStateOf<Int?>(null) }
    val single = images.size == 1
    Column(Modifier.widthIn(max = 280.dp).testTag("image-grid"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        images.chunked(if (single) 1 else 2).forEachIndexed { row, pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                pair.forEachIndexed { col, img ->
                    val ratio = if (single && img.width > 0 && img.height > 0) (img.width.toFloat() / img.height).coerceIn(.5f, 2.5f) else 1f
                    AsyncImage(
                        model = urlFor(img.id),
                        contentDescription = "Image jointe : ${img.name}",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.weight(1f).aspectRatio(ratio).clip(RoundedCornerShape(12.dp)).background(DfColors.Surface)
                            .clickable { open = row * 2 + col },
                    )
                }
            }
        }
    }
    open?.let { i -> ImageViewerDialog(images, i, urlFor, onClose = { open = null }) }
}

/** Visionneuse plein écran : pincer pour zoomer, glisser vers le bas ou retour pour fermer. */
@Composable
fun ImageViewerDialog(images: List<AttachmentInfo>, start: Int, urlFor: (String) -> String?, onClose: () -> Unit) {
    var index by remember { mutableStateOf(start) }
    var scale by remember { mutableFloatStateOf(1f) }
    var dragY by remember { mutableFloatStateOf(0f) }
    val img = images.getOrNull(index) ?: return onClose()
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .92f * (1f - (dragY / 1200f).coerceIn(0f, .6f)))).testTag("image-viewer")) {
            AsyncImage(
                model = urlFor(img.id),
                contentDescription = img.name,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize()
                    .pointerInput(index) { detectTransformGestures { _, _, zoom, _ -> scale = (scale * zoom).coerceIn(1f, 4f) } }
                    .pointerInput(index) {
                        detectVerticalDragGestures(
                            onDragEnd = { if (dragY > 300f) onClose() else dragY = 0f },
                            onVerticalDrag = { _, dy -> if (scale <= 1.01f) dragY = (dragY + dy).coerceAtLeast(0f) },
                        )
                    }
                    .graphicsLayer(scaleX = scale, scaleY = scale, translationY = dragY),
            )
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    (if (images.size > 1) "${index + 1}/${images.size}  " else "") + img.name,
                    color = Color.White.copy(alpha = .8f),
                    fontSize = 14.sp,
                    modifier = Modifier.weight(1f).padding(start = 8.dp),
                )
                if (index > 0) TextButton(onClick = { index--; scale = 1f }) { Text("‹", color = Color.White, fontSize = 22.sp) }
                if (index < images.size - 1) TextButton(onClick = { index++; scale = 1f }) { Text("›", color = Color.White, fontSize = 22.sp) }
                IconButton(onClick = onClose, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Filled.Close, contentDescription = "Fermer", tint = Color.White)
                }
            }
        }
    }
}

/** Vignettes 56 dp du composer (✕ pour retirer). */
@Composable
fun PendingImagesRow(images: List<PendingImage>, onRemove: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp).testTag("pending-images"), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        images.forEach { p ->
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(10.dp)).background(DfColors.Surface)) {
                val bmp = remember(p.localId) { p.preview?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }.getOrNull() } }
                if (bmp != null) Image(bmp, contentDescription = p.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().alpha(if (p.status == "ready") 1f else .6f))
                when (p.status) {
                    "uploading" -> CircularProgressIndicator(Modifier.size(18.dp).align(Alignment.Center), strokeWidth = 2.dp, color = Color.White)
                    "error" -> Icon(Icons.Filled.ErrorOutline, contentDescription = p.error ?: "Échec", tint = DfColors.Danger, modifier = Modifier.align(Alignment.Center))
                }
                Box(
                    Modifier.align(Alignment.TopEnd).size(24.dp).clip(CircleShape).background(Color.Black.copy(alpha = .7f)).clickable { onRemove(p.localId) }
                        .semantics { contentDescription = "Retirer l’image ${p.name}" },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.Close, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp)) }
            }
        }
    }
}

/** Bouton trombone : sélecteur photo système (sans permission), 4 images au plus. */
@Composable
fun AttachImageButton(enabled: Boolean, onPicked: (ByteArray, String, String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(4)) { uris: List<Uri> ->
        scope.launch {
            uris.forEach { uri ->
                val loaded = withContext(Dispatchers.IO) {
                    runCatching {
                        val mime = context.contentResolver.getType(uri) ?: "image/png"
                        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@runCatching null
                        val name = uri.lastPathSegment?.substringAfterLast('/')?.take(60) ?: "image"
                        Triple(bytes, mime, name)
                    }.getOrNull()
                }
                loaded?.let { (b, m, n) -> onPicked(b, m, n) }
            }
        }
    }
    IconButton(
        onClick = { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
        enabled = enabled,
        modifier = Modifier.size(52.dp).testTag("attach-image"),
    ) {
        Icon(Icons.Filled.AttachFile, contentDescription = "Joindre une image", tint = if (enabled) DfColors.InkMuted else DfColors.InkFaint)
    }
}
