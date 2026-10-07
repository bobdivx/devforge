package app.jeser.devforge.notify

import app.jeser.devforge.data.InboxEvent

/**
 * Décide quoi notifier à partir d'un instantané de la boîte de réception.
 *
 * - Premier passage : on mémorise sans notifier (pas d'avalanche à l'installation).
 * - Ensuite : seuls les identifiants absents du passage précédent sont notifiés.
 * - Les identifiants d'événements « en cours » (app en panne, spec en attente) disparaissent
 *   quand la situation se règle ; une nouvelle panne sera donc notifiée à nouveau.
 *
 * Le même format d'événement servira à un push (FCM / UnifiedPush) : seul le transport change.
 */
object InboxDiff {
    data class Result(val toNotify: List<InboxEvent>, val seen: Set<String>)

    fun compute(events: List<InboxEvent>, previous: Set<String>?, notify: Boolean = true): Result {
        val ids = events.map { it.id }.toSet()
        if (previous == null || !notify) return Result(emptyList(), ids)
        return Result(events.filter { it.id !in previous }.distinctBy { it.id }, ids)
    }
}

/** Mémoire du dernier instantané (préférences non sensibles : seulement des identifiants). */
interface InboxMemory {
    fun seen(): Set<String>?
    fun saveSeen(ids: Set<String>)
}

class PrefsInboxMemory(context: android.content.Context) : InboxMemory {
    private val prefs = context.getSharedPreferences("devforge_inbox", android.content.Context.MODE_PRIVATE)
    override fun seen(): Set<String>? =
        if (prefs.getBoolean("seeded", false)) prefs.getStringSet("seen", emptySet())!!.toSet() else null

    override fun saveSeen(ids: Set<String>) {
        prefs.edit().putBoolean("seeded", true).putStringSet("seen", ids).apply()
    }

    fun reset() = prefs.edit().clear().apply()
}
