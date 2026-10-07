package app.jeser.devforge

import app.jeser.devforge.data.ChatEvent
import app.jeser.devforge.data.InboxEvent
import app.jeser.devforge.data.SseParser
import app.jeser.devforge.notify.InboxDiff
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SseAndInboxTest {
    private fun feedAll(p: SseParser, text: String) = text.split("\n").mapNotNull { p.feed(it) }

    @Test fun sse_progress_reply_error() {
        val events = feedAll(
            SseParser(),
            """
            event: message
            data: {"type":"thinking","round":0,"label":"Connexion aux modèles…"}

            event: message
            data: {"type":"tool_start","name":"read_project_file","arguments":{}}

            data: {"type":"plan","title":"x","summary":"","steps":[]}

            data: {"type":"reply","content":"Fait **!**","provider":"p","tool_calls":[]}

            """.trimIndent() + "\n",
        )
        assertEquals(ChatEvent.Progress("Connexion aux modèles…"), events[0])
        assertEquals(ChatEvent.Progress("Lit le projet…"), events[1])
        assertEquals(ChatEvent.Reply("Fait **!**", "p"), events[2])
        assertEquals(3, events.size)
        val err = feedAll(SseParser(), "data: {\"type\":\"error\",\"message\":\"boom\"}\n\n")
        assertEquals(ChatEvent.Failure("boom"), err.single())
    }

    @Test fun sse_multiline_data_and_garbage() {
        val p = SseParser()
        assertNull(p.feed("data: {\"type\":\"reply\","))
        assertNull(p.feed("data: \"content\":\"ok\"}"))
        assertEquals(ChatEvent.Reply("ok", null), p.feed(""))
        assertNull(p.feed("data: pas du json"))
        assertNull(p.feed(""))
    }

    private fun ev(id: String) = InboxEvent(id = id, kind = "deploy_failed", projectUuid = "p")

    @Test fun first_sync_is_silent() {
        val r = InboxDiff.compute(listOf(ev("a"), ev("b")), previous = null)
        assertTrue(r.toNotify.isEmpty())
        assertEquals(setOf("a", "b"), r.seen)
    }

    @Test fun only_new_ids_are_notified_and_recovered_ones_can_come_back() {
        val r1 = InboxDiff.compute(listOf(ev("a"), ev("c")), previous = setOf("a", "b"))
        assertEquals(listOf("c"), r1.toNotify.map { it.id })
        assertEquals(setOf("a", "c"), r1.seen)
        // « b » a disparu (réglé) puis revient : notifié à nouveau
        val r2 = InboxDiff.compute(listOf(ev("a"), ev("b"), ev("c")), previous = r1.seen)
        assertEquals(listOf("b"), r2.toNotify.map { it.id })
    }

    @Test fun foreground_sync_never_notifies() {
        val r = InboxDiff.compute(listOf(ev("x")), previous = emptySet(), notify = false)
        assertTrue(r.toNotify.isEmpty())
        assertEquals(setOf("x"), r.seen)
    }
}
