package app.jeser.devforge.notify

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.jeser.devforge.AppGraph
import app.jeser.devforge.data.UnauthorizedException
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Suit les déploiements en cours : met à jour la notif de progression,
 * puis se replanifie ~20 s tant qu'il reste un build / deploy actif.
 */
class DeployWatchWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val graph = AppGraph.get(applicationContext)
        if (graph.store.load() == null) return Result.success()
        return try {
            val still = graph.syncDeployProgress()
            if (still) schedule(applicationContext, delaySec = 20)
            Result.success()
        } catch (_: UnauthorizedException) {
            Result.success()
        } catch (_: IOException) {
            Result.retry()
        }
    }

    companion object {
        private const val NAME = "devforge-deploy-watch"

        /**
         * Démarre le suivi s'il n'est pas déjà planifié (KEEP : n'interrompt pas le cycle ~20 s).
         * Pour forcer un tick immédiat après un « Mettre en ligne », utiliser [force].
         */
        fun kick(context: Context, force: Boolean = false) {
            val req = OneTimeWorkRequestBuilder<DeployWatchWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                NAME,
                if (force) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
                req,
            )
        }

        fun schedule(context: Context, delaySec: Long) {
            val req = OneTimeWorkRequestBuilder<DeployWatchWorker>()
                .setInitialDelay(delaySec.coerceAtLeast(0), TimeUnit.SECONDS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, req)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NAME)
            Notifier.clearDeployProgress(context)
        }
    }
}
