package app.jeser.devforge

import app.jeser.devforge.data.Agent
import app.jeser.devforge.data.AppStatus
import app.jeser.devforge.data.ContainerState
import app.jeser.devforge.data.ContainerStatus
import app.jeser.devforge.data.Deployment
import app.jeser.devforge.data.DevForgeJson
import app.jeser.devforge.data.GitInfo
import app.jeser.devforge.data.LifecycleResult
import app.jeser.devforge.data.PersonaKey
import app.jeser.devforge.data.Project
import app.jeser.devforge.data.SpecFeature
import app.jeser.devforge.data.Tone
import app.jeser.devforge.data.appIconCandidates
import app.jeser.devforge.data.frenchDuration
import app.jeser.devforge.data.iconInitials
import app.jeser.devforge.data.iconPaletteIndex
import app.jeser.devforge.data.liveSummary
import app.jeser.devforge.data.parseContainerStatus
import app.jeser.devforge.data.syncLabel
import app.jeser.devforge.data.teamStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveStatusTest {
    private fun cs(msg: String, phase: String = "running") = parseContainerStatus(ContainerStatus(phase, true, msg))

    @Test fun dockerStatusStrings() {
        assertEquals(ContainerState(ContainerState.Kind.Running, "24 h"), cs("Up 24 hours"))
        assertEquals(ContainerState.Health.Healthy, cs("Up 3 minutes (healthy)").health)
        assertEquals(ContainerState.Health.Unhealthy, cs("Up 1 hour (unhealthy)").health)
        assertEquals(ContainerState.Health.Starting, cs("Up 2 seconds (health: starting)").health)
        val exited = cs("Exited (137) 5 minutes ago", "stopped")
        assertEquals(ContainerState.Kind.Exited, exited.kind)
        assertEquals("5 min", exited.duration)
        assertEquals(ContainerState.Kind.Missing, cs("aucun conteneur", "stopped").kind)
        assertEquals(ContainerState.Kind.Restarting, cs("Restarting (1) 10 seconds ago", "stopped").kind)
        assertEquals(ContainerState.Kind.Paused, cs("Up 2 days (Paused)").kind)
        assertEquals(ContainerState.Kind.Unknown, parseContainerStatus(null).kind)
        assertEquals(ContainerState.Kind.Unknown, cs("ssh: connect timed out", "unknown").kind)
    }

    @Test fun durationsInFrench() {
        assertEquals("1 h", frenchDuration("Up About an hour"))
        assertEquals("1 min", frenchDuration("Up About a minute"))
        assertEquals("1 s", frenchDuration("Up Less than a second"))
        assertEquals("3 j", frenchDuration("Up 3 days"))
        assertEquals("2 sem.", frenchDuration("Up 2 weeks"))
        assertEquals("5 mois", frenchDuration("Exited (0) 5 months ago"))
        assertNull(frenchDuration("Created"))
    }

    private val live = Project("p", "Vigie", status = "live", productionUrl = "https://vigie.jeser.app", gitRepository = "https://github.com/bobdivx/Vigie")
    private val ok = Deployment("d1", "success", createdAt = "2026-10-07T10:00:00Z")
    private val failed = Deployment("d2", "failed", createdAt = "2026-10-07T11:00:00Z")
    private val running = Deployment("d3", "running", createdAt = "2026-10-07T12:00:00Z")

    @Test fun summaryCombinesContainerProbeAndDeploys() {
        val up = cs("Up 26 hours (healthy)")
        liveSummary(live, up, ok).let {
            assertEquals(AppStatus.Live, it.status)
            assertEquals("depuis 26 h", it.since)
            assertEquals("Le site répond · contrôle Docker OK", it.health)
            assertEquals(true, it.healthOk)
        }
        // Le conteneur tourne mais la sonde HTTP échoue → « Ne répond plus ».
        assertEquals(AppStatus.Down, liveSummary(live.copy(status = "unhealthy"), up, ok).status)
        // Échec de mise en ligne mais l'ancienne version tourne → toujours en ligne.
        assertEquals(AppStatus.Live, liveSummary(live.copy(status = "failed"), up, failed).status)
        // Échec et rien ne tourne → en échec.
        assertEquals(AppStatus.Failed, liveSummary(live, cs("Exited (1) 2 minutes ago", "stopped"), failed).status)
        // Arrêtée volontairement.
        liveSummary(live.copy(status = "stopped"), cs("Exited (0) 3 hours ago", "stopped"), ok).let {
            assertEquals(AppStatus.Stopped, it.status)
            assertEquals("arrêtée il y a 3 h", it.since)
            assertEquals(false, it.healthOk)
        }
        assertEquals(AppStatus.Deploying, liveSummary(live, up, running).status)
        val draft = Project("q", "Carnet", status = "draft")
        assertEquals(AppStatus.Draft, liveSummary(draft, cs("aucun conteneur", "stopped"), null).status)
    }

    @Test fun githubSyncLabel() {
        val g = DevForgeJson.decodeFromString<GitInfo>(
            """{"available":true,"branch":"main","sync":{"state":"behind","behind_by":3,"deployed_sha":"722e248"},"workdir":{"available":true,"dirty":true,"files":[{"path":"a","status":"M"}]}}""",
        )
        assertEquals("GitHub : 3 commits pas encore en ligne", syncLabel(g))
        assertEquals("GitHub : à jour", syncLabel(g.copy(sync = g.sync!!.copy(state = "up_to_date"))))
        assertNull(syncLabel(GitInfo(available = false)))
        assertTrue(g.workdir!!.dirty)
    }

    @Test fun lifecycleAndStatusEnvelopes() {
        val r = DevForgeJson.decodeFromString<LifecycleResult>("""{"ok":false,"phase":"stop","error":"no such container"}""")
        assertFalse(r.ok)
        assertEquals("no such container", r.error)
        val s = DevForgeJson.decodeFromString<ContainerStatus>("""{"healthy":true,"message":"Up 24 hours","phase":"running","project_uuid":"x"}""")
        assertEquals(ContainerState.Kind.Running, parseContainerStatus(s).kind)
    }

    @Test fun teamMatchesWebRules() {
        val agents = listOf(
            Agent("1", role = "coordinator"), Agent("2", role = "ops"), Agent("3", role = "reviewer", status = "working"),
            Agent("4", role = "custom", kind = "custom", triggerType = "event", triggerConfig = """{"event":"deploy_fail"}"""),
        )
        val team = teamStatus(agents, listOf(SpecFeature("s", "Page contact", "awaiting_validation")), failed)
        assertEquals(listOf(PersonaKey.Braise, PersonaKey.Phare, PersonaKey.Rustine, PersonaKey.Plume), team.map { it.key })
        assertEquals("Attend ton OK", team[0].label)
        assertEquals(Tone.Warn, team[0].tone)
        assertEquals("Veille", team[1].label)
        assertEquals("Une panne à regarder", team[2].label)
        assertEquals("Relit…", team[3].label)
    }

    @Test fun iconSourcesMatchWeb() {
        val c = appIconCandidates("https://client.popcornn.app, https://popcornn.app", "https://github.com/bobdivx/popcornn.git")
        assertEquals("https://client.popcornn.app/apple-touch-icon.png", c.first())
        assertTrue(c.contains("https://client.popcornn.app/favicon.svg"))
        assertEquals("https://github.com/bobdivx.png?size=128", c.last())
        assertTrue(appIconCandidates(null, null).isEmpty())
        assertEquals("CD", iconInitials("Carnet de recettes"))
        assertEquals("TS", iconInitials("template-studio"))
        assertEquals("VI", iconInitials("Vigie"))
        // Même hachage que le web : (h * 31 + c) | 0.
        var h = 0
        for (ch in "Vigie") h = h * 31 + ch.code
        assertEquals(kotlin.math.abs(h) % 8, iconPaletteIndex("Vigie"))
    }
}
