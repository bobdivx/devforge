package app.jeser.devforge

import app.jeser.devforge.data.ApprovalReceipt
import app.jeser.devforge.data.DevForgeJson
import app.jeser.devforge.data.ReceiptList
import app.jeser.devforge.ui.receipts.ReceiptFilter
import app.jeser.devforge.ui.receipts.ReceiptTone
import app.jeser.devforge.ui.receipts.receiptDetails
import app.jeser.devforge.ui.receipts.receiptStatusLabel
import app.jeser.devforge.ui.receipts.receiptSubtitle
import app.jeser.devforge.ui.receipts.receiptWhen
import app.jeser.devforge.ui.receipts.shortVersion
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiptsTest {
    @Test fun parsesServerList() {
        val raw = """{"data":[{"uuid":"r1","workspace_uuid":"w","project_uuid":"p1","project_name":"Vigie",
            "action":"stop","action_label":"Arrêter","target":"Vigie","version":null,"action_hash":"abcdef0123456789",
            "status":"unknown","source":"android","approved_by":"u1","approved_by_label":"Mathieu",
            "approved_at":"2026-10-25T13:05:00.123456Z","expires_at":"2026-10-25T13:35:00Z","consumed_at":null,
            "finished_at":null,"detail":"DevForge a redémarré","run_uuid":null,"tool_name":null,"deployment_uuid":null,
            "created_at":"2026-10-25T13:05:00Z","updated_at":"2026-10-25T13:05:00Z"}],"next_before":null}"""
        val list = DevForgeJson.decodeFromString(ReceiptList.serializer(), raw)
        assertEquals(1, list.data.size)
        val r = list.data[0]
        assertEquals("Arrêter", r.actionLabel)
        assertEquals("Mathieu", r.approvedByLabel)
        assertNull(list.nextBefore)
        // 13:05 UTC = 14:05 à Paris (UTC+1 fin octobre).
        assertEquals("25 oct. 14:05", receiptWhen(r.approvedAt))
    }

    @Test fun statusLabelsMatchWeb() {
        assertEquals("Réussi" to ReceiptTone.Ok, receiptStatusLabel("done"))
        assertEquals("Échec" to ReceiptTone.Danger, receiptStatusLabel("failed"))
        assertEquals("Issue inconnue" to ReceiptTone.Warn, receiptStatusLabel("unknown"))
        assertEquals("x" to ReceiptTone.Neutral, receiptStatusLabel("x"))
        assertEquals("failed,unknown", ReceiptFilter.Problems.statuses)
        assertNull(ReceiptFilter.All.statuses)
    }

    @Test fun detailsSkipEmptyFields() {
        val r = ApprovalReceipt(
            uuid = "r1", projectName = "Vigie", action = "deploy", actionLabel = "Mettre en ligne", target = "Vigie",
            version = "0123456789abcdef0123", actionHash = "abcdef0123456789", status = "done", source = "web",
            approvedByLabel = "Mathieu",
        )
        val d = receiptDetails(r).toMap()
        assertEquals("0123456", d["Version"])
        assertEquals("Web", d["Depuis"])
        assertEquals("abcdef012345", d["Empreinte"])
        assertFalse(d.containsKey("Outil"))
        assertTrue(receiptSubtitle(r).endsWith("par Mathieu"))
        assertEquals("main", shortVersion("main"))
        assertNull(shortVersion(" "))
    }
}
