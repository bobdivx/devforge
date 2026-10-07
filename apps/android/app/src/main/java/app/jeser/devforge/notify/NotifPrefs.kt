package app.jeser.devforge.notify

import android.content.Context

/** Types de notifications (réglables dans Réglages). Tous actifs par défaut. */
enum class NotifKind(val key: String, val title: String, val description: String) {
    DeployFailed("deploy_failed", "Mise en ligne échouée", "Rustine 🩹 te prévient et peut réparer."),
    AppDown("app_down", "App qui ne répond plus", "Phare 🗼 a repéré une app en panne."),
    SpecWaiting("spec_waiting", "Braise attend ton OK", "Une spec est prête à relire."),
}

interface NotifSettings {
    fun enabled(kind: String): Boolean
    fun set(kind: String, on: Boolean)
}

class PrefsNotifSettings(context: Context) : NotifSettings {
    private val prefs = context.getSharedPreferences("notif_prefs", Context.MODE_PRIVATE)
    override fun enabled(kind: String): Boolean = prefs.getBoolean(kind, true)
    override fun set(kind: String, on: Boolean) = prefs.edit().putBoolean(kind, on).apply()
}

class MemoryNotifSettings(private val map: MutableMap<String, Boolean> = mutableMapOf()) : NotifSettings {
    override fun enabled(kind: String): Boolean = map[kind] ?: true
    override fun set(kind: String, on: Boolean) { map[kind] = on }
}
