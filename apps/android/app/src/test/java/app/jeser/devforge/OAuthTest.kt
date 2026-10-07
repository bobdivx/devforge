package app.jeser.devforge

import android.app.Application
import android.net.Uri
import app.jeser.devforge.auth.OAuth
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class OAuthTest {
    @Test fun pkce_matches_rfc7636_vector() {
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            OAuth.challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        )
        val v = OAuth.randomUrlSafe(48)
        assertTrue(v.length in 43..128)
        assertTrue(v.all { it.isLetterOrDigit() || it == '-' || it == '_' })
    }

    @Test fun instance_normalization() {
        assertEquals("https://web.jeser.app", OAuth.normalizeInstance(" web.jeser.app/ "))
        assertEquals("https://web.jeser.app", OAuth.normalizeInstance("https://web.jeser.app/api/v1"))
        assertEquals("http://10.0.2.2:8000", OAuth.normalizeInstance("http://10.0.2.2:8000"))
        assertNull(OAuth.normalizeInstance("http://exemple.com"))
        assertNull(OAuth.normalizeInstance(""))
    }

    @Test fun authorize_url_has_pkce_scope_and_app_redirect() {
        val u = Uri.parse(OAuth.authorizeUrl("https://web.jeser.app/oauth/authorize", "dfc_x", "st", "ch"))
        assertEquals("code", u.getQueryParameter("response_type"))
        assertEquals("dfc_x", u.getQueryParameter("client_id"))
        assertEquals("app.jeser.devforge:/oauth/callback", u.getQueryParameter("redirect_uri"))
        assertEquals("api offline_access", u.getQueryParameter("scope"))
        assertEquals("S256", u.getQueryParameter("code_challenge_method"))
        assertEquals("ch", u.getQueryParameter("code_challenge"))
        assertEquals("st", u.getQueryParameter("state"))
    }

    @Test fun callback_checks_state() {
        assertEquals(OAuth.Callback.Code("abc"), OAuth.parseCallback(mapOf("code" to "abc", "state" to "s"), "s"))
        assertTrue(OAuth.parseCallback(mapOf("code" to "abc", "state" to "autre"), "s") is OAuth.Callback.Error)
        assertEquals(
            OAuth.Callback.Error("Connexion refusée."),
            OAuth.parseCallback(mapOf("error" to "access_denied", "state" to "s"), "s"),
        )
        assertTrue(OAuth.parseCallback(mapOf("state" to "s"), "s") is OAuth.Callback.Error)
    }

    @Test fun redirect_is_parsed_from_app_scheme() {
        val uri = Uri.parse("app.jeser.devforge:/oauth/callback?code=c1&state=s1&iss=https%3A%2F%2Fweb.jeser.app")
        assertEquals("app.jeser.devforge", uri.scheme)
        assertEquals("c1", uri.getQueryParameter("code"))
    }
}
