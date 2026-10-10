package app.jeser.devforge

import app.jeser.devforge.data.BranchUpdate
import app.jeser.devforge.data.DataEnvelope
import app.jeser.devforge.data.Deployment
import app.jeser.devforge.data.DevForgeJson
import app.jeser.devforge.data.ProjectBranches
import app.jeser.devforge.data.githubOwnerRepo
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BranchesTest {
    @Test fun branches_payload_parses() {
        val json = """{"data":{"production":{"branch":"main","url":"https://template-studio.jeser.app"},
            "dev":{"enabled":true,"branch":"devforge-dev-test","url":"https://dev-template-studio.jeser.app",
            "container":"df-dvabc","env_from":"production",
            "last_deployment":{"uuid":"d1","status":"success","git_sha":"abc1234"}},"auto_deploy":true}}"""
        val b = DevForgeJson.decodeFromString(DataEnvelope.serializer(ProjectBranches.serializer()), json).data
        assertEquals("main", b.production.branch)
        assertTrue(b.dev.enabled)
        assertEquals("devforge-dev-test", b.dev.branch)
        assertEquals("https://dev-template-studio.jeser.app", b.dev.url)
        assertEquals("success", b.dev.lastDeployment?.status)
        assertTrue(b.autoDeploy)
    }

    @Test fun disabled_dev_parses() {
        val json = """{"ok":true,"data":{"production":{"branch":"main"},"dev":{"enabled":false,"branch":null}}}"""
        val u = DevForgeJson.decodeFromString(BranchUpdate.serializer(), json)
        assertTrue(u.ok)
        assertFalse(u.data.dev.enabled)
        assertNull(u.deploymentUuid)
    }

    @Test fun deployments_are_labelled_prod_or_dev() {
        val json = """{"data":[{"uuid":"a","status":"success","environment":"dev"},
            {"uuid":"b","status":"success","environment":"production"},{"uuid":"c","status":"failed"}]}"""
        val d = DevForgeJson.decodeFromString(DataEnvelope.serializer(ListSerializer(Deployment.serializer())), json).data
        assertEquals(listOf("Dev", "Prod", "Prod"), d.map { it.envLabel })
        assertTrue(d[0].isDev)
        assertFalse(d[2].isDev)
    }

    @Test fun github_owner_repo() {
        assertEquals("bobdivx" to "devforge", githubOwnerRepo("https://github.com/bobdivx/devforge"))
        assertEquals("bobdivx" to "devforge", githubOwnerRepo("https://github.com/bobdivx/devforge.git"))
        assertEquals("o" to "r", githubOwnerRepo("git@github.com:o/r.git"))
        assertNull(githubOwnerRepo("https://gitlab.com/o/r"))
    }
}
