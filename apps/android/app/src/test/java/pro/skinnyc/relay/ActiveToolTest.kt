package pro.skinnyc.relay
import org.junit.Assert.*
import org.junit.Test
class ActiveToolTest {
    private fun event(kind: String, body: org.json.JSONObject = json()) = ChatEvent(json("kind" to kind, "data" to body))
    @Test fun parallelCompletionsAndNativeBoundaries() {
        val a = event("tool.invocation", json("toolCallId" to "a", "input" to "{\"command\":\"ssh desktop2025\"}"))
        val b = event("tool.invocation", json("toolCallId" to "b"))
        assertEquals(listOf(a), activeToolCalls(listOf(a, b, event("tool.output", json("toolCallId" to "b")))))
        assertEquals(listOf(a), activeToolCalls(listOf(a, event("tool.output", json("toolCallId" to "other")))))
        assertTrue(activeToolCalls(listOf(a, event("turn.completed"))).isEmpty())
        assertTrue(activeToolCalls(listOf(a, event("turn.started"))).isEmpty())
        val old = event("tool.invocation", json("input" to json("command" to "test")))
        assertTrue(activeToolCalls(listOf(old, event("tool.output", json("toolCallId" to "legacy")))).isEmpty())
        assertEquals("ssh desktop2025", toolCommand(a))
        assertEquals("test", toolCommand(old))
    }
}
