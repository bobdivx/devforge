package app.jeser.devforge

import app.jeser.devforge.data.AgentMessage
import app.jeser.devforge.data.ReactionInfo
import app.jeser.devforge.data.answerFromToolCalls
import app.jeser.devforge.data.answerModelText
import app.jeser.devforge.data.questionFromToolCalls
import app.jeser.devforge.data.toggleReaction
import app.jeser.devforge.ui.project.toChatItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RichChatTest {
    private val ask = """[{"name":"ask_user","result":{"ok":true,"awaiting_answer":true,"question":"On publie ?","options":[{"id":"yes","label":"Oui","action":"approve_publish","style":"primary"},{"id":"no","label":"Non"}],"allow_free_text":false}}]"""

    @Test fun questionParsed() {
        val m = AgentMessage(uuid = "a1", role = "assistant", content = "On publie ?", toolCallsJson = ask)
        val q = questionFromToolCalls(m.toolCalls)!!
        assertEquals("On publie ?", q.question)
        assertEquals(listOf("yes", "no"), q.options.map { it.id })
        assertEquals("approve_publish", q.options[0].action)
        assertEquals(false, q.allowFreeText)
        assertEquals(q, m.toChatItem(0).question)
    }

    @Test fun invalidQuestionIgnored() {
        assertNull(questionFromToolCalls(AgentMessage(role = "assistant", toolCallsJson = """[{"name":"ask_user","result":{"ok":false,"error":"x"}}]""").toolCalls))
        assertNull(questionFromToolCalls(AgentMessage(role = "assistant", toolCallsJson = """[{"name":"ask_user","result":{"question":"q","options":[{"id":"a","label":"A"}]}}]""").toolCalls))
    }

    @Test fun answerAndExtras() {
        val m = AgentMessage(
            uuid = "u1", role = "user", content = "Réponse…",
            toolCallsJson = """[{"name":"answer","result":{"answer_to":"a1","option_id":"no","label":"Non","text":null}}]""",
            attachmentsJson = """[{"id":"${"f".repeat(64)}","url":"/api/v1/attachments/x","name":"c.png","mime":"image/png","width":10,"height":20}]""",
            reactionsJson = """[{"emoji":"👍","count":2,"mine":true}]""",
        )
        val item = m.toChatItem(0)
        assertEquals("a1", item.answer?.answerTo)
        assertEquals("Non", item.answer?.display)
        assertEquals(20, item.attachments.single().height)
        assertEquals(listOf(ReactionInfo("👍", 2, true)), item.reactions)
        assertEquals("Non", answerFromToolCalls(m.toolCalls)?.label)
    }

    @Test fun reactionToggle() {
        val start = listOf(ReactionInfo("👍", 1, true), ReactionInfo("🎉", 1, false))
        assertEquals(listOf(ReactionInfo("🎉", 1, false)), toggleReaction(start, "👍"))
        assertEquals(listOf(ReactionInfo("👍", 1, true), ReactionInfo("🎉", 2, true)), toggleReaction(start, "🎉"))
        assertEquals(start + ReactionInfo("🚀", 1, true), toggleReaction(start, "🚀"))
    }

    @Test fun modelText() {
        assertEquals("Réponse à ta question « On publie ? » : Oui", answerModelText("On publie ?", "Oui"))
        assertEquals("Réponse à ta question « On publie ? » : Autre — demain", answerModelText("On publie ?", "Autre", "demain"))
    }
}
