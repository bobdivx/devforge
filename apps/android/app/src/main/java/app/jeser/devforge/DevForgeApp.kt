package app.jeser.devforge

import android.app.Application
import app.jeser.devforge.notify.InboxWorker
import app.jeser.devforge.notify.Notifier

class DevForgeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.createChannels(this)
        if (AppGraph.get(this).store.load() != null) InboxWorker.schedule(this)
    }
}
