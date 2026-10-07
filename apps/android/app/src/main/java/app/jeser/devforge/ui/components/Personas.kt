package app.jeser.devforge.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.jeser.devforge.R

/** Les quatre personnages de DevForge (mêmes avatars que le web). */
enum class Persona(val displayName: String, val emoji: String, val job: String, @DrawableRes val avatar: Int) {
    Braise("Braise", "🔥", "bâtisseuse", R.drawable.persona_braise),
    Phare("Phare", "🗼", "veille", R.drawable.persona_phare),
    Rustine("Rustine", "🩹", "répare", R.drawable.persona_rustine),
    Plume("Plume", "🪶", "relit", R.drawable.persona_plume),
}

@Composable
fun PersonaAvatar(persona: Persona, size: Dp = 36.dp, modifier: Modifier = Modifier) {
    Image(
        painter = painterResource(persona.avatar),
        contentDescription = "${persona.displayName}, ${persona.job}",
        modifier = modifier.size(size),
    )
}
