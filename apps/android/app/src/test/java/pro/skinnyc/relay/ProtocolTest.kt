package pro.skinnyc.relay

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class ProtocolTest {
    @Test
    fun sessionsSortWorkingFirstThenAttentionThenIdleByNewestActivity() {
        fun session(id: String, status: String, time: String, pinned: Boolean = false) =
            Session(
                json("id" to id, "status" to status, "lastActivity" to time, "pinned" to pinned)
            )
        val rows =
            listOf(
                session("idle", "idle", "2026-10-09T15:00:00Z", true),
                session("old", "working", "2026-10-09T10:00:00Z"),
                session("ended", "ended", "2026-10-09T16:00:00Z"),
                session("question", "blocked", "2026-10-09T11:00:00Z"),
                session("new", "working", "2026-10-09T12:00:00Z"),
            )
        assertEquals(
            listOf("new", "old", "question", "idle", "ended"),
            sortedSessions(rows).map { it.id },
        )
        assertEquals(sortedSessions(rows), sortedSessions(rows.reversed()))
    }

    private fun event(id: String, seq: Int, kind: String, text: String, item: String = "a") =
        ChatEvent(
            json(
                "id" to id,
                "sequence" to seq,
                "sourceId" to id,
                "kind" to kind,
                "data" to json("text" to text, "itemId" to item),
            )
        )

    @Test
    fun replayHasStableIdentityAndOrdering() {
        val a = event("a", 1, "user.message", "Same text")
        val b = event("b", 2, "user.message", "Same text")
        assertEquals(listOf("a", "b"), mergeEvents(listOf(b), listOf(a, b)).map { it.id })
    }

    @Test
    fun streamedMessageIsReplacedByAuthoritativeCompleteMessage() {
        val a = event("a", 1, "assistant.delta", "Hello ")
        val b = event("b", 2, "assistant.delta", "world")
        assertEquals("Hello world", conversationRows(listOf(a, b)).single().text)
        assertEquals(
            "Hello world!",
            conversationRows(listOf(a, b, event("c", 3, "assistant.message", "Hello world!")))
                .single()
                .text,
        )
    }

    @Test
    fun explicitSourceReplacementsRemoveSupersededEvents() {
        val old = event("old", 1, "user.message", "Old")
        val replacement = event("new", 2, "user.message", "New")
        replacement.body.put("replacesEventSourceIds", org.json.JSONArray(listOf("old")))
        assertEquals(listOf("new"), mergeEvents(listOf(old), listOf(replacement)).map { it.id })
    }

    @Test
    fun queueIsNeverTheDefaultWhenNativeSteeringIsSupported() {
        val session =
            Session(
                json(
                    "status" to "working",
                    "capabilities" to json("steerActiveTurn" to true, "queueTask" to true),
                )
            )
        assertEquals(listOf("steer", "queue"), session.modes())
    }

    @Test
    fun capabilityFlagsCannotInventSteering() {
        val session =
            Session(json("status" to "working", "capabilities" to json("sendMessage" to true)))
        assertTrue(session.modes().isEmpty())
    }

    @Test
    fun questionReplyEnvelopeBecomesReadableText() {
        assertEquals(
            "**Which?**\nAlpha",
            displayText(
                "<send_user_message_question_reply>[{\"question\":\"Which?\",\"answer\":\"Alpha\"}]</send_user_message_question_reply>"
            ),
        )
        assertEquals("Hi", displayText("Hi\n[Relay request 12ab-34cd]"))
    }

    @Test
    fun mutationsCarryExactRequestIdAndDoNotRetryOnRejection() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setResponseCode(409).setBody("{\"error\":\"Session replaced\"}")
            )
            val api = RelayApi(server.url("/").toString().trimEnd('/'))
            try {
                api.api(
                    "/api/sessions/test/messages",
                    "POST",
                    json("prompt" to "hello", "idempotencyKey" to "stable-id"),
                )
                fail("Expected rejection")
            } catch (e: ApiFailure) {
                assertEquals(409, e.status)
            }
            val request = server.takeRequest()
            assertEquals("1", request.getHeader("X-RC-Request"))
            assertTrue(request.body.readUtf8().contains("stable-id"))
            assertEquals(1, server.requestCount)
        }
    }

    @Test
    fun pendingQuestionsBlockNewTurnsButKeepExplicitQueueAvailable() {
        val session =
            Session(
                json(
                    "status" to "blocked",
                    "pendingCount" to 1,
                    "capabilities" to json("steerActiveTurn" to true, "queueTask" to true),
                )
            )
        assertEquals(listOf("queue"), session.modes())
    }
}
