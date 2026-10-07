package app.jeser.devforge

import android.app.Application
import app.jeser.devforge.notify.InboxWorker
import app.jeser.devforge.notify.Notifier
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.decode.SvgDecoder

class DevForgeApp : Application(), ImageLoaderFactory {
    override fun onCreate() {
        super.onCreate()
        Notifier.createChannels(this)
        if (AppGraph.get(this).store.load() != null) InboxWorker.schedule(this)
    }

    /** Icônes d'app : PNG/ICO du site, et favicon.svg comme sur le web. */
    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this)
        .components { add(SvgDecoder.Factory()) }
        .crossfade(true)
        .respectCacheHeaders(false)
        .build()
}
