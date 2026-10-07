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

object Notifier {
    const val CHANNEL_ALERTS = "alerts"
    const val CHANNEL_WAITING = "waiting"
    const val EXTRA_PROJECT = "project_uuid"

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
    }

    fun canNotify(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    fun openProjectIntent(context: Context, projectUuid: String): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = "app.jeser.devforge.OPEN_PROJECT.$projectUuid"
            putExtra(EXTRA_PROJECT, projectUuid)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            context,
            projectUuid.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    fun show(context: Context, events: List<InboxEvent>) {
        val settings = PrefsNotifSettings(context)
        val wanted = events.filter { settings.enabled(it.kind) }
        if (wanted.isEmpty() || !canNotify(context)) return
        val nm = NotificationManagerCompat.from(context)
        for (e in wanted.take(6)) {
            val channel = if (e.kind == "spec_waiting") CHANNEL_WAITING else CHANNEL_ALERTS
            val n = NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_stat_devforge)
                .setColor(0xFFA78BFA.toInt())
                .setContentTitle(e.title)
                .setContentText(e.body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(e.body))
                .setContentIntent(openProjectIntent(context, e.projectUuid))
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
}
