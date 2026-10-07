package app.jeser.devforge

import app.jeser.devforge.data.cleanLogs
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

class CleanLogsTest {
    private val paris = ZoneId.of("Europe/Paris")

    @Test fun stripsAnsiAndShortensTimestamps() {
        val raw = "2026-10-06T12:26:32.143961566Z \u001B[90mStopping server\u001B[39m\n" +
            "2026-10-06T12:26:33Z ➜ Listening on: http://0.0.0.0:3000"
        assertEquals(
            "06/10 14:26:32  Stopping server\n06/10 14:26:33  ➜ Listening on: http://0.0.0.0:3000",
            cleanLogs(raw, paris),
        )
    }

    @Test fun appliesCarriageReturnsAndSplitsInlineTimestamps() {
        val raw = "2026-10-07T13:13:21.958901115Z \u001B[90m\rStopping server (5s)...\u001B[39m\u001B[2K\r\u001B[32mServer closed successfully.\n" +
            "2026-10-07T13:13:23.019232380Z \u001B[39m2026-10-07T13:13:23.454397435Z ➜ Listening on: http://localhost/\n"
        assertEquals(
            "07/10 15:13:21  Server closed successfully.\n07/10 15:13:23  ➜ Listening on: http://localhost/",
            cleanLogs(raw, paris),
        )
    }

    @Test fun leavesPlainLinesAlone() {
        assertEquals("build ok\nstep 2/5", cleanLogs("build ok\r\nstep 2/5", paris))
    }
}
