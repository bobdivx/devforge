package app.jeser.devforge.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.jeser.devforge.MainActivity
import app.jeser.devforge.R
import app.jeser.devforge.data.InboxEvent
import app.jeser.devforge.data.Project

object Notifier {
    const val CHANNEL_ALERTS = "alerts"
    const val CHANNEL_WAITING = "waiting"
    const val CHANNEL_PROGRESS = "progress"
    const val EXTRA_PROJECT = "project_uuid"
    const val EXTRA_OPEN = "open"
    const val OPEN_CORRECTIONS = "corrections"
    const val OPEN_WATCHES = "watches"

    private const val PROGRESS_PREFS = "devforge_deploy_progress"
    private const val KEY_ACTIVE = "active"

    /** Réglage qui couvre un type d'événement (les 3 étapes de correction partagent un réglage). */
    fun settingKey(kind: String): String = when {
        kind.startsWith("correction_") || kind == "fix_ready" -> NotifKind.Corrections.key
        kind.startsWith("watch_") -> NotifKind.WatchAlerts.key
        else -> kind
    }

    /** Écran à ouvrir quand on touche la notif (null = page de l'app). */
    fun openTarget(kind: String): String? = when {
        kind.startsWith("correction_") || kind == "fix_ready" -> OPEN_CORRECTIONS
        kind.startsWith("watch_") -> OPEN_WATCHES
        else -> null
    }

    /** Canal : « à regarder » pour ce qui attend l'utilisateur, « alertes » pour les pannes. */
    fun channelFor(kind: String): String =
        if (kind == "spec_waiting" || kind == "fix_ready" || kind == "correction_live" || kind == "watch_alert") CHANNEL_WAITING else CHANNEL_ALERTS

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ALERTS, context.getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_HIGH)
                .apply { description = context.getString(R.string.channel_alerts_desc) },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_WAITING, context.getString(R.string.channel_waiting), NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = context.getString(R.string.channel_waiting_desc) },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_PROGRESS, context.getString(R.string.channel_progress), NotificationManager.IMPORTANCE_LOW)
                .apply {
                    description = context.getString(R.string.channel_progress_desc)
                    setShowBadge(false)
                },
        )
    }

    fun canNotify(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    fun openProjectIntent(context: Context, projectUuid: String, open: String? = null): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = "app.jeser.devforge.OPEN_PROJECT.$projectUuid${open?.let { ".$it" } ?: ""}"
            putExtra(EXTRA_PROJECT, projectUuid)
            open?.let { putExtra(EXTRA_OPEN, it) }
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            context,
            (projectUuid + (open ?: "")).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    fun show(context: Context, events: List<InboxEvent>) {
        val settings = PrefsNotifSettings(context)
        val wanted = events.filter { settings.enabled(settingKey(it.kind)) }
        if (wanted.isEmpty() || !canNotify(context)) return
        val nm = NotificationManagerCompat.from(context)
        for (e in wanted.take(6)) {
            val channel = channelFor(e.kind)
            val n = NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_stat_devforge)
                .setColor(0xFFA78BFA.toInt())
                .setContentTitle(e.title)
                .setContentText(e.body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(e.body))
                .setContentIntent(openProjectIntent(context, e.projectUuid, openTarget(e.kind)))
                .setAutoCancel(true)
                .setCategory(if (channel == CHANNEL_ALERTS) NotificationCompat.CATEGORY_ERROR else NotificationCompat.CATEGORY_REMINDER)
                .setGroup("devforge")
                .build()
            try {
                nm.notify(e.id.hashCode(), n)
            } catch (_: SecurityException) {
                return
            }
        }
    }

    /**
     * Met à jour les notifs « déploiement en cours » (barre de progression).
     * @return true s'il reste au moins un déploiement actif (pour replanifier le worker).
     */
    fun syncDeployProgress(context: Context, projects: List<Project>): Boolean {
        val settings = PrefsNotifSettings(context)
        val enabled = settings.enabled(NotifKind.DeployProgress.key)
        val deploying = projects.mapNotNull { deployProgressOf(it) }
        val prefs = context.getSharedPreferences(PROGRESS_PREFS, Context.MODE_PRIVATE)
        val previous = prefs.getStringSet(KEY_ACTIVE, emptySet())!!.toSet()
        val nowIds = deploying.map { it.projectUuid }.toSet()

        // Annuler les notifs des déploiements terminés (succès ou disparus de la liste « deploying »).
        for (uuid in previous - nowIds) {
            cancelProgress(context, uuid)
        }

        if (!enabled || !canNotify(context)) {
            if (!enabled) {
                for (uuid in nowIds) cancelProgress(context, uuid)
                prefs.edit().putStringSet(KEY_ACTIVE, emptySet()).apply()
            } else {
                prefs.edit().putStringSet(KEY_ACTIVE, nowIds).apply()
            }
            return deploying.isNotEmpty()
        }

        val nm = NotificationManagerCompat.from(context)
        for (p in deploying) {
            val body = listOfNotNull(p.label, p.detail).joinToString(" · ")
            val n = NotificationCompat.Builder(context, CHANNEL_PROGRESS)
                .setSmallIcon(R.drawable.ic_stat_devforge)
                .setColor(0xFFA78BFA.toInt())
                .setContentTitle("Déploiement · ${p.projectName}")
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setProgress(100, p.percent, false)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openProjectIntent(context, p.projectUuid))
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setGroup("devforge-progress")
                .setSilent(true)
                .build()
            try {
                nm.notify(progressNotifId(p.projectUuid), n)
            } catch (_: SecurityException) {
                break
            }
        }
        prefs.edit().putStringSet(KEY_ACTIVE, nowIds).apply()
        return deploying.isNotEmpty()
    }

    fun clearDeployProgress(context: Context) {
        val prefs = context.getSharedPreferences(PROGRESS_PREFS, Context.MODE_PRIVATE)
        val active = prefs.getStringSet(KEY_ACTIVE, emptySet())!!.toSet()
        for (uuid in active) cancelProgress(context, uuid)
        prefs.edit().putStringSet(KEY_ACTIVE, emptySet()).apply()
    }

    private fun cancelProgress(context: Context, projectUuid: String) {
        NotificationManagerCompat.from(context).cancel(progressNotifId(projectUuid))
    }

    /** Identifiant stable, distinct des notifs inbox (`e.id.hashCode()`). */
    fun progressNotifId(projectUuid: String): Int = ("deploying:$projectUuid").hashCode()
}
