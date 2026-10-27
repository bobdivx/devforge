package app.jeser.devforge

import app.jeser.devforge.data.DevForgeJson
import app.jeser.devforge.data.Inbox
import app.jeser.devforge.data.PageWatch
import app.jeser.devforge.data.WatchDetail
import app.jeser.devforge.data.WatchList
import app.jeser.devforge.notify.NotifKind
import app.jeser.devforge.notify.Notifier
import app.jeser.devforge.ui.watches.WatchTone
import app.jeser.devforge.ui.watches.checkOutcome
import app.jeser.devforge.ui.watches.formatAmount
import app.jeser.devforge.ui.watches.intervalLabel
import app.jeser.devforge.ui.watches.watchCondition
import app.jeser.devforge.ui.watches.watchDetails
import app.jeser.devforge.ui.watches.watchHost
import app.jeser.devforge.ui.watches.watchStatus
import app.jeser.devforge.ui.watches.watchSubtitle
import app.jeser.devforge.ui.watches.watchWhen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchesTest {
    private val base = PageWatch(uuid = "w1", name = "Billets", url = "https://www.exemple.fr/concert", lastCheckAt = "2026-10-25T13:05:00Z")

    @Test fun parsesServerList() {
        val raw = """{"data":[{"uuid":"w1","workspace_uuid":"ws","created_by":"u1","name":"Casque","url":"https://shop.fr/p/1",
            "kind":"price","needle":null,"text_mode":null,"price_op":"below","threshold":199.9,"currency":"EUR",
            "interval_minutes":360,"status":"active","paused_reason":null,"failure_streak":0,
            "last_check_at":"2026-10-25T13:05:00.123456Z","next_check_at":"2026-10-25T19:05:00Z","last_success_at":null,
            "last_error":null,"last_http_status":200,"last_value":"219,00 €","last_summary":"Prix relevé : 219,00 €",
            "condition_met":false,"last_hash":"ab","alert_seq":0,"last_alert_at":null,
            "created_at":"2026-10-25T13:00:00Z","updated_at":"2026-10-25T13:05:00Z"}],"unread_alerts":2}"""
        val list = DevForgeJson.decodeFromString(WatchList.serializer(), raw)
        assertEquals(2, list.unreadAlerts)
        val w = list.data.single()
        assertEquals("below", w.priceOp)
        assertEquals(199.9, w.threshold!!, 0.0001)
        assertEquals(360, w.intervalMinutes)
        assertEquals("219,00 € · Prix ≤ 199,90 €", watchSubtitle(w))
        assertEquals("25 oct. 14:05", watchWhen(w.lastCheckAt))
    }

    @Test fun parsesDetailWithChecks() {
        val raw = """{"data":{"uuid":"w1","url":"https://a.fr","kind":"change"},
            "checks":[{"uuid":"c1","watch_uuid":"w1","checked_at":"2026-10-25T13:05:00Z","outcome":"error",
            "http_status":503,"duration_ms":120,"value":null,"summary":null,"error":"HTTP 503","state_hash":null,"alerted":false}]}"""
        val d = DevForgeJson.decodeFromString(WatchDetail.serializer(), raw)
        assertEquals("HTTP 503", d.checks.single().error)
        assertEquals("Erreur" to WatchTone.Danger, checkOutcome(d.checks.single().outcome))
    }

    @Test fun statusLabelsMatchWeb() {
        assertEquals("Surveillée" to WatchTone.Ok, watchStatus(base))
        assertEquals("Première lecture…" to WatchTone.Accent, watchStatus(base.copy(lastCheckAt = null)))
        assertEquals("Erreur 2/5" to WatchTone.Warn, watchStatus(base.copy(failureStreak = 2)))
        assertEquals("En pause" to WatchTone.Neutral, watchStatus(base.copy(status = "paused", pausedReason = "user")))
        assertEquals(
            "En pause · page injoignable" to WatchTone.Danger,
            watchStatus(base.copy(status = "paused", pausedReason = "failures", failureStreak = 5)),
        )
        assertEquals("Condition remplie" to WatchTone.Ok, watchStatus(base.copy(kind = "text", needle = "Complet", conditionMet = true)))
    }

    @Test fun conditions() {
        assertEquals("Tout changement du texte", watchCondition(base))
        assertEquals("« Complet » disparaît", watchCondition(base.copy(kind = "text", needle = "Complet", textMode = "disappears")))
        assertEquals("« Dispo » apparaît", watchCondition(base.copy(kind = "text", needle = "Dispo", textMode = "appears")))
        assertEquals("Prix ≥ $50", watchCondition(base.copy(kind = "price", priceOp = "above", threshold = 50.0, currency = "USD")))
        assertEquals("12,50 €", formatAmount(12.5, "EUR"))
        assertEquals("30 min", intervalLabel(30))
        assertEquals("24 h", intervalLabel(1440))
        assertEquals("exemple.fr", watchHost(base.url))
    }

    @Test fun detailsSkipEmptyFields() {
        val d = watchDetails(base.copy(nextCheckAt = null)).map { it.first }
        assertTrue("Guette" in d)
        assertFalse("Dernière valeur" in d) // pas de valeur pour « changement »
        assertFalse("Dernière alerte" in d)
        val paused = watchDetails(base.copy(status = "paused", nextCheckAt = "2026-10-25T14:00:00Z")).map { it.first }
        assertFalse("Prochaine" in paused)
        assertNull(watchWhen("pas une date"))
    }

    @Test fun inboxEventsRouteToWatches() {
        val raw = """{"events":[{"id":"watch:a1","kind":"watch_alert","project_uuid":"","project_name":"Billets",
            "title":"Billets : condition remplie","body":"« Complet » a disparu","created_at":"2026-10-25T13:05:00Z"}]}"""
        val e = DevForgeJson.decodeFromString(Inbox.serializer(), raw).events.single()
        assertEquals(NotifKind.WatchAlerts.key, Notifier.settingKey(e.kind))
        assertEquals(NotifKind.WatchAlerts.key, Notifier.settingKey("watch_paused"))
        assertEquals(Notifier.OPEN_WATCHES, Notifier.openTarget(e.kind))
        assertEquals(Notifier.CHANNEL_WAITING, Notifier.channelFor("watch_alert"))
        assertEquals(Notifier.CHANNEL_ALERTS, Notifier.channelFor("watch_paused"))
        // Les réglages existants ne bougent pas.
        assertEquals(NotifKind.Corrections.key, Notifier.settingKey("fix_ready"))
        assertEquals(Notifier.OPEN_CORRECTIONS, Notifier.openTarget("correction_failed"))
        assertNull(Notifier.openTarget("deploy_failed"))
        assertEquals("deploy_failed", Notifier.settingKey("deploy_failed"))
    }
}
