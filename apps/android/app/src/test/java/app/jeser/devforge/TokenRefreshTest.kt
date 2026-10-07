package app.jeser.devforge

import app.jeser.devforge.auth.OAuthHttp
import app.jeser.devforge.data.ApiClient
import app.jeser.devforge.data.AuthKind
import app.jeser.devforge.data.InMemorySessionStore
import app.jeser.devforge.data.Session
import app.jeser.devforge.data.TokenManager
import app.jeser.devforge.data.UnauthorizedException
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class TokenRefreshTest {
    private lateinit var server: MockWebServer
    private val http = OkHttpClient()
    private var validAccess = "dfoa_new"
    private var refreshCalls = 0
    private var refreshOk = true

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                return when {
                    path.startsWith("/oauth/token") -> {
                        refreshCalls++
                        val body = request.body.readUtf8()
                        if (!refreshOk || !body.contains("grant_type=refresh_token")) {
                            MockResponse().setResponseCode(400).setBody("""{"error":"invalid_grant"}""")
                        } else {
                            MockResponse().setBody(
                                """{"access_token":"$validAccess","refresh_token":"dfor_2","expires_in":3600,"token_type":"Bearer","scope":"mcp offline_access api"}""",
                            )
                        }
                    }
                    path.startsWith("/api/v1/projects") ->
                        if (request.getHeader("Authorization") == "Bearer $validAccess") {
                            MockResponse().setBody(Fixtures.read("projects.json"))
                        } else {
                            MockResponse().setResponseCode(401).setBody("""{"error":"Non authentifié"}""")
                        }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
    }

    @After fun tearDown() = server.shutdown()

    private fun base() = server.url("/").toString().trimEnd('/')

    private fun client(store: InMemorySessionStore, now: Long = 1_000, onOut: () -> Unit = {}): ApiClient {
        val tm = TokenManager(store, { OAuthHttp(http) }, now = { now }, onSignedOut = onOut)
        return ApiClient({ store.load()?.instanceUrl }, tm, http)
    }

    @Test fun expired_token_is_refreshed_before_the_call() = runTest {
        val store = InMemorySessionStore(Session(base(), AuthKind.OAuth, "dfoa_old", "dfor_1", expiresAt = 1_030, clientId = "dfc_1"))
        val projects = client(store).projects()
        assertEquals(3, projects.size)
        assertEquals(1, refreshCalls)
        assertEquals("dfoa_new", store.load()!!.accessToken)
        assertEquals("dfor_2", store.load()!!.refreshToken)
        assertEquals(1_000 + 3600L, store.load()!!.expiresAt)
    }

    @Test fun unauthorized_triggers_one_refresh_and_retry() = runTest {
        val store = InMemorySessionStore(Session(base(), AuthKind.OAuth, "dfoa_revoked", "dfor_1", expiresAt = 99_999, clientId = "dfc_1"))
        assertEquals(3, client(store).projects().size)
        assertEquals(1, refreshCalls)
    }

    @Test fun failed_refresh_signs_out() = runTest {
        refreshOk = false
        var out = false
        val store = InMemorySessionStore(Session(base(), AuthKind.OAuth, "dfoa_revoked", "dfor_1", expiresAt = 99_999, clientId = "dfc_1"))
        try {
            client(store, onOut = { out = true }).projects()
            fail("doit lever")
        } catch (e: UnauthorizedException) {
            // attendu
        }
        assertTrue(out)
        assertNull(store.load())
    }

    @Test fun valid_token_does_not_refresh() = runTest {
        val store = InMemorySessionStore(Session(base(), AuthKind.OAuth, "dfoa_new", "dfor_1", expiresAt = 99_999, clientId = "dfc_1"))
        client(store).projects()
        assertEquals(0, refreshCalls)
        assertFalse(store.load() == null)
    }
}
