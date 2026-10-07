package app.jeser.devforge

import app.jeser.devforge.data.Agent
import app.jeser.devforge.data.AgentMessage
import app.jeser.devforge.data.ApiClient
import app.jeser.devforge.data.AppStatus
import app.jeser.devforge.data.DataEnvelope
import app.jeser.devforge.data.DevForgeJson
import app.jeser.devforge.data.Inbox
import app.jeser.devforge.data.Project
import app.jeser.devforge.data.ProjectDetail
import app.jeser.devforge.data.SpecFeature
import app.jeser.devforge.data.apiErrorMessage
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ParsingTest {
    private inline fun <reified T> list(name: String, s: kotlinx.serialization.KSerializer<T>) =
        DevForgeJson.decodeFromString(DataEnvelope.serializer(ListSerializer(s)), Fixtures.read(name)).data

    @Test fun projects_list_is_tolerant() {
        val p = list("projects.json", Project.serializer())
        assertEquals(3, p.size)
        assertEquals("popcorn", p[0].name)
        assertTrue(p[0].autoDeployEnabled)
        assertEquals(AppStatus.Live, p[0].appStatus)
        assertEquals("ae471f0", p[0].deploy?.sha)
        assertEquals("https://client.example.app", p[0].productionUrl)
        // champ inconnu + valeurs nulles
        assertEquals(AppStatus.Failed, p[1].appStatus)
        assertNull(p[1].productionUrl)
        assertFalse(p[1].autoDeployEnabled)
        // objet minimal
        assertEquals(AppStatus.Draft, p[2].appStatus)
    }

    @Test fun project_detail_with_int_auto_deploy_and_deployments() {
        val d = DevForgeJson.decodeFromString(DataEnvelope.serializer(ProjectDetail.serializer()), Fixtures.read("project.json")).data
        assertEquals("Vigie", d.project.name)
        assertTrue(d.project.autoDeployEnabled)
        assertEquals(2, d.deployments.size)
        assertTrue(d.deployments[0].isSuccess)
        assertTrue(d.deployments[1].isFailed)
        assertEquals("npm ERR! missing script: build", d.deployments[1].errorSummary)
    }

    @Test fun agents_find_coordinator() {
        val a = list("agents.json", Agent.serializer())
        assertEquals("agent-coord", a.first { it.role == "coordinator" }.uuid)
    }

    @Test fun messages_tool_calls_and_plan() {
        val m = list("messages.json", AgentMessage.serializer())
        assertEquals(4, m.size)
        assertEquals("user", m[0].role)
        assertEquals(1, m[1].toolCalls.size)
        assertEquals("list_env_vars", m[1].toolCalls[0].name)
        assertFalse(m[1].hasPlan)
        assertTrue(m[2].hasPlan)
        // JSON d'outils invalide : liste vide, pas de crash
        assertTrue(m[3].toolCalls.isEmpty())
    }

    @Test fun specs_awaiting_validation_excludes_dismissed() {
        val s = list("specs.json", SpecFeature.serializer())
        assertEquals(listOf("001-contact"), s.filter { it.awaitingValidation }.map { it.slug })
    }

    @Test fun inbox_events() {
        val i = DevForgeJson.decodeFromString(DataEnvelope.serializer(Inbox.serializer()), Fixtures.read("inbox.json")).data
        assertEquals(3, i.events.size)
        assertEquals(setOf("spec_waiting", "deploy_failed", "app_down"), i.events.map { it.kind }.toSet())
        assertEquals("p2", i.events[1].projectUuid)
        assertEquals("2026-10-07T10:00:00+00:00", i.serverTime)
    }

    @Test fun logs_both_shapes() {
        assertEquals("a\nb", ApiClient.parseLogs("""{"data":{"logs":"a\nb","status":"failed"}}"""))
        assertEquals("x", ApiClient.parseLogs("""{"logs":"x"}"""))
        assertEquals("", ApiClient.parseLogs("""{"data":{"logs":null}}"""))
    }

    @Test fun spec_detail() {
        val (f, md) = ApiClient.parseSpec("""{"data":{"slug":"001-a","title":"A","phase":"awaiting_validation","attempts":0,"updated_at":"t"},"spec_md":"# A"}""")
        assertEquals("001-a", f.slug)
        assertTrue(f.awaitingValidation)
        assertEquals("# A", md)
    }

    @Test fun api_error_message() {
        assertEquals("nope", apiErrorMessage("""{"error":"nope"}"""))
        assertNull(apiErrorMessage("<html>"))
        assertNull(apiErrorMessage(null))
    }

    @Test fun status_mapping() {
        assertEquals(AppStatus.Deploying, AppStatus.from("building"))
        assertEquals(AppStatus.Down, AppStatus.from("unhealthy"))
        assertEquals(AppStatus.Down, AppStatus.from("unrouted"))
        assertEquals(AppStatus.Stopped, AppStatus.from("stopped"))
        assertEquals(AppStatus.Draft, AppStatus.from(null))
    }
}
