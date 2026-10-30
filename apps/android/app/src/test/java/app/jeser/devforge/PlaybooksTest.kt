package app.jeser.devforge

import app.jeser.devforge.data.DataEnvelope
import app.jeser.devforge.data.DevForgeJson
import app.jeser.devforge.data.GrokWakeResult
import app.jeser.devforge.data.LiveCounters
import app.jeser.devforge.data.Playbook
import app.jeser.devforge.data.RunLive
import app.jeser.devforge.data.evidenceUrl
import app.jeser.devforge.data.livePills
import app.jeser.devforge.data.needsHelp
import app.jeser.devforge.data.stepStateLabel
import app.jeser.devforge.data.workerStepState
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybooksTest {
    @Test fun parsesCatalog() {
        val raw = """{"data":[{"id":"deploy-verify","slash":"/deploy-verify","name":"Déployer & vérifier",
            "description":"d","steps":["a","b","c"],"rule":"r","visual":"rocket","goal_label":"","goal_placeholder":"",
            "uses_workers":false,"extra":1}]}"""
        val list = DevForgeJson.decodeFromString(DataEnvelope.serializer(ListSerializer(Playbook.serializer())), raw).data
        assertEquals(1, list.size)
        assertEquals("/deploy-verify", list[0].slash)
        assertEquals(3, list[0].steps.size)
        assertFalse(list[0].usesWorkers)
    }

    @Test fun parsesLiveCard() {
        val raw = """{"data":{"run_uuid":"r1","project_uuid":"p1","status":"completed","live":false,"verdict":"incomplete",
            "status_text":"Terminé — 1 étape(s) sans résultat","title":"/swarm · Essaim","error":null,
            "playbook":{"id":"swarm","slash":"/swarm","name":"Essaim","rule":"r","visual":"swarm"},
            "steps":[{"n":1,"label":"Découper","state":"ok"},{"n":2,"label":"Lancer","state":"ok"},{"n":3,"label":"Synthèse","state":"missing"}],
            "workers":[{"run_uuid":"w1","title":"A","agent_name":"Worker","status":"completed","live":false,"summary":"s","error":null}],
            "counters":{"tools_ok":4,"tools_failed":1,"workers_total":1,"workers_done":1,"workers_failed":0,"decisions":1},
            "decisions":[{"what":"x","why":"y","evidence":"https://e.fr/a","outcome":"ok","step":1}]}}"""
        val live = DevForgeJson.decodeFromString(DataEnvelope.serializer(RunLive.serializer()), raw).data
        assertEquals("missing", live.steps[2].state)
        assertEquals("Sans résultat", stepStateLabel(live.steps[2].state))
        assertEquals("ok", workerStepState(live.workers[0].status))
        assertTrue(live.needsHelp)
        assertEquals(listOf("Workers 1/1", "4 actions OK", "1 échec", "1 décision"), livePills(live.counters))
    }

    @Test fun pillsAndEvidence() {
        assertEquals(listOf("0 action OK", "0 décision"), livePills(LiveCounters()))
        assertEquals("https://e.fr/a", evidenceUrl("https://e.fr/a"))
        assertNull(evidenceUrl("src/main.rs"))
        assertNull(evidenceUrl("javascript:alert(1)"))
        assertEquals("failed", workerStepState("cancelled"))
    }

    @Test fun parsesWakeResult() {
        val r = DevForgeJson.decodeFromString(
            DataEnvelope.serializer(GrokWakeResult.serializer()),
            """{"data":{"ok":true,"status":200,"message":"Bot réveillé","event":"devforge.wake"}}""",
        ).data
        assertTrue(r.ok)
        assertEquals(200, r.status)
    }
}
