package app.jeser.devforge.notify

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.jeser.devforge.AppGraph
import app.jeser.devforge.data.UnauthorizedException
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Synchro périodique (15 min, réseau requis) : pas de service push en v1. */
class InboxWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val graph = AppGraph.get(applicationContext)
        if (graph.store.load() == null) return Result.success()
        return try {
            graph.syncInbox(notify = true)
            Result.success()
        } catch (e: UnauthorizedException) {
            Result.success()
        } catch (e: IOException) {
            Result.retry()
        }
    }

    companion object {
        private const val NAME = "devforge-inbox"

        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<InboxWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NAME)
        }
    }
}
