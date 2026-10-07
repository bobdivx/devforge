package app.jeser.devforge

import app.jeser.devforge.data.DeployPlan
import app.jeser.devforge.data.Deployment
import app.jeser.devforge.data.GitCommit
import app.jeser.devforge.data.GitInfo
import app.jeser.devforge.data.GitSync
import app.jeser.devforge.data.GitWorkdir
import app.jeser.devforge.data.GitFile
import app.jeser.devforge.data.deployPlan
import app.jeser.devforge.data.isNewerVersion
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeployPlanTest {
    private val ok = Deployment("d", "success", "abc1234")
    private fun git(state: String, behind: Int = 0, commits: List<GitCommit> = emptyList(), dirty: Boolean = false) =
        GitInfo(true, "main", null, GitSync(state, behind, 0, "abc1234", commits = commits),
            GitWorkdir(true, dirty, if (dirty) listOf(GitFile("M", "a"), GitFile("M", "b")) else emptyList()))

    @Test fun upToDateMeansRebuildInMoreNotPrimary() {
        val p = deployPlan(true, ok, git("up_to_date"), deploying = false)
        assertEquals(DeployPlan.Kind.Rebuild, p.kind)
        assertFalse(p.primary)
        assertTrue(p.upToDate)
        assertEquals("L'app est déjà à jour. Reconstruire relance une construction depuis GitHub sans changement de code.", p.rebuildExplanation)
    }

    @Test fun commitsOnGithubMeansPublishChanges() {
        val p = deployPlan(true, ok, git("behind", 2, listOf(GitCommit("1", "Ancien"), GitCommit("2", "Page tarifs\nDétails"))), deploying = false)
        assertEquals(DeployPlan.Kind.PublishChanges, p.kind)
        assertTrue(p.primary)
        assertEquals("Publier les changements", p.label)
        assertEquals("2 changements sur GitHub · « Page tarifs »", p.summary)
    }

    @Test fun failedMeansRetryAndRunningMeansInProgress() {
        assertEquals(DeployPlan.Kind.Retry, deployPlan(true, ok.copy(status = "failed"), git("error"), false).kind)
        assertEquals(DeployPlan.Kind.InProgress, deployPlan(true, ok.copy(status = "running"), git("deploying"), false).kind)
        assertEquals(DeployPlan.Kind.InProgress, deployPlan(true, ok, git("up_to_date"), deploying = true).kind)
    }

    @Test fun firstDeployAndNoRepo() {
        assertEquals(DeployPlan.Kind.FirstDeploy, deployPlan(true, null, null, false).kind)
        assertEquals(DeployPlan.Kind.None, deployPlan(false, ok, null, false).kind)
    }

    @Test fun unknownSyncIsRebuildButNotUpToDate_andDraftCounted() {
        val p = deployPlan(true, ok, git("unknown", dirty = true), false)
        assertEquals(DeployPlan.Kind.Rebuild, p.kind)
        assertFalse(p.upToDate)
        assertEquals(2, p.draftFiles)
    }

    @Test fun versions() {
        assertTrue(isNewerVersion("2.0.200", "2.0.199"))
        assertTrue(isNewerVersion("2.1.0", "2.0.199"))
        assertFalse(isNewerVersion("2.0.199", "2.0.199"))
        assertFalse(isNewerVersion("2.0.198", "2.0.199-debug"))
        assertFalse(isNewerVersion(null, "2.0.199"))
    }
}
