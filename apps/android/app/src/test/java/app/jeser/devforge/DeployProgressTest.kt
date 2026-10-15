package app.jeser.devforge

import app.jeser.devforge.data.AppStatus
import app.jeser.devforge.data.DeployCard
import app.jeser.devforge.data.Project
import app.jeser.devforge.notify.anyDeploying
import app.jeser.devforge.notify.deployProgressOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeployProgressTest {
    private fun project(
        status: String,
        deployStatus: String? = null,
        message: String? = null,
        uuid: String = "p1",
        name: String = "Vigie",
    ) = Project(
        uuid = uuid,
        name = name,
        status = status,
        deploy = deployStatus?.let { DeployCard(status = it, message = message) },
    )

    @Test fun no_progress_when_live() {
        assertNull(deployProgressOf(project("live", "success")))
    }

    @Test fun phases_map_to_percent_and_label() {
        val queued = deployProgressOf(project("deploying", "queued"))!!
        assertEquals(12, queued.percent)
        assertTrue(queued.label.contains("file", ignoreCase = true))

        val building = deployProgressOf(project("building", "building"))!!
        assertEquals(42, building.percent)
        assertTrue(building.label.contains("Build", ignoreCase = true))

        val running = deployProgressOf(project("deploying", "running", message = "Landing"))!!
        assertEquals(72, running.percent)
        assertEquals("Landing", running.detail)
        assertEquals("Vigie", running.projectName)
    }

    @Test fun project_status_building_alone() {
        val p = deployProgressOf(project("building"))!!
        assertEquals(AppStatus.Deploying, project("building").appStatus)
        assertEquals(42, p.percent)
    }

    @Test fun any_deploying() {
        assertFalse(anyDeploying(listOf(project("live"), project("failed"))))
        assertTrue(anyDeploying(listOf(project("live"), project("deploying", "running"))))
    }
}
