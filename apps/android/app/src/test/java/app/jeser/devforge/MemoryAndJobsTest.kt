package app.jeser.devforge

import app.jeser.devforge.data.AgentRunInfo
import app.jeser.devforge.data.DevForgeJson
import app.jeser.devforge.data.MemoryItem
import app.jeser.devforge.data.MemoryList
import app.jeser.devforge.data.RunMilestone
import app.jeser.devforge.data.jobsFromToolCalls
import app.jeser.devforge.data.mergeJobStatus
import app.jeser.devforge.data.parseToolCalls
import app.jeser.devforge.ui.memory.BudgetTone
import app.jeser.devforge.ui.memory.forgetConfirm
import app.jeser.devforge.ui.memory.memoryBudgetState
import app.jeser.devforge.ui.memory.memoryScopeLabel
import app.jeser.devforge.ui.memory.memorySourceLabel
import app.jeser.devforge.ui.memory.pinConfirm
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MemoryAndJobsTest {
    @Test fun parsesMemoryList() {
        val raw = """{"ok":true,"has_more":false,"profile_budget":{"used":320,"max":1500},
            "items":[{"uuid":"m1","scope":"project","project_name":"Vigie","tier":"profile","kind":"infra","content":"NAS","source":"user_said",
            "inferred":false,"pinned":true,"created_by":"user","updated_at":"2026-10-10T10:00:00Z","confidence":0.9,"extra":1}]}"""
        val list = DevForgeJson.decodeFromString(MemoryList.serializer(), raw)
        assertEquals(320, list.profileBudget.used)
        assertEquals("Vigie", list.items[0].projectName)
        assertTrue(list.items[0].pinned)
    }

    @Test fun labels() {
        assertEquals("dit par toi", memorySourceLabel(MemoryItem("1", createdBy = "user", source = "user_said")))
        assertEquals("noté par DevForge", memorySourceLabel(MemoryItem("1", createdBy = "system", source = "system")))
        assertEquals("déduit par Braise", memorySourceLabel(MemoryItem("1", createdBy = "agent:x", source = "agent_inferred", inferred = true)))
        assertEquals("retenu par Ops (tu l'as dit)", memorySourceLabel(MemoryItem("1", createdBy = "agent:x", createdByName = "Ops", source = "user_said")))
        assertEquals("Toutes tes apps", memoryScopeLabel(MemoryItem("1", scope = "user")))
        assertEquals("Fil · Braise", memoryScopeLabel(MemoryItem("1", scope = "agent", agentName = "Braise")))
    }

    @Test fun budget() {
        assertEquals(20 to BudgetTone.Ok, memoryBudgetState(300, 1500))
        assertEquals(BudgetTone.Warn, memoryBudgetState(1300, 1500).second)
        assertEquals(100 to BudgetTone.Danger, memoryBudgetState(1600, 1500))
        assertEquals(0 to BudgetTone.Ok, memoryBudgetState(0, 0))
    }

    @Test fun confirmations() {
        assertTrue(forgetConfirm(MemoryItem("1", content = "x".repeat(300))).danger)
        assertEquals("Désépingler", pinConfirm(MemoryItem("1", pinned = true)).confirmLabel)
        assertEquals("Épingler", pinConfirm(MemoryItem("1")).confirmLabel)
    }

    @Test fun jobsFromCalls() {
        val calls = parseToolCalls(
            """[{"name":"delegate_task","result":{"ok":true,"status":"started","run_uuid":"r1","title":"Refonte"}},
                {"name":"delegate_task","result":{"ok":true,"status":"queued","run_uuid":"r2","title":"Contact"}},
                {"name":"delegate_task","result":{"ok":false,"error":"x"}},
                {"name":"trigger_deploy","result":{"ok":true,"deployment_uuid":"d1","status":"pending"}},
                {"name":"job_result","result":{"status":"completed","run_uuid":"r1","title":"Refonte","summary":"OK","files":["a","b"]}}]""",
        )
        val jobs = jobsFromToolCalls(calls)
        assertEquals(listOf("r1", "r2", "d1"), jobs.map { it.id })
        assertEquals("done", jobs[0].status)
        assertEquals(2, jobs[0].files)
        assertEquals("queued", jobs[1].status)
        assertEquals("deploy", jobs[2].kind)
    }

    @Test fun laterResultAndLiveRunUpdateEarlierCards() {
        val first = jobsFromToolCalls(parseToolCalls("""[{"name":"delegate_task","result":{"ok":true,"status":"started","run_uuid":"r1","title":"A"}},
            {"name":"delegate_task","result":{"ok":true,"status":"started","run_uuid":"r2","title":"B"}}]"""))
        val later = jobsFromToolCalls(parseToolCalls("""[{"name":"job_result","result":{"status":"failed","run_uuid":"r1","title":"A","summary":"build KO"}}]"""))
        val live = mapOf("r2" to AgentRunInfo("r2", "running", progress = listOf(RunMilestone("Build", "running"))))
        val merged = mergeJobStatus(listOf(first, later), live)
        assertEquals("failed", merged[0][0].status)
        assertEquals("build KO", merged[0][0].summary)
        assertEquals("Build", merged[0][1].milestones.single().label)
        assertTrue(merged[0][1].live)
    }

    @Test fun pausedAndRetriedRunsFollowTheirLease() {
        assertEquals("paused", app.jeser.devforge.data.jobStatus("paused"))
        val first = jobsFromToolCalls(parseToolCalls("""[{"name":"delegate_task","result":{"ok":true,"status":"started","run_uuid":"r1","title":"A"}},
            {"name":"delegate_task","result":{"ok":true,"status":"started","run_uuid":"r2","title":"B"}}]"""))
        val later = jobsFromToolCalls(parseToolCalls("""[{"name":"job_result","result":{"status":"failed","run_uuid":"r1","title":"A","summary":"build KO"}}]"""))
        // r1 relancé après son échec, r2 mis en pause : l'état du run prime sur la carte de résultat.
        val live = mapOf(
            "r1" to AgentRunInfo("r1", "running", kind = "worker"),
            "r2" to AgentRunInfo("r2", "paused", kind = "worker"),
        )
        val merged = mergeJobStatus(listOf(first, later), live)
        assertTrue(merged[0][0].live)
        assertTrue(merged[1][0].live)
        assertTrue(merged[0][1].paused)
        assertEquals("En pause", app.jeser.devforge.ui.project.JOB_STATUS_LABEL["paused"])
    }
}
