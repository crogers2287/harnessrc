package pro.skinnyc.relay
import org.junit.Assert.*
import org.junit.Test

class SessionCommandsTest {
    @Test fun slashInputIsNotAnOrdinaryMessageOrFilesystemPath() {
        assertTrue(isSlashCommand("/compact"))
        assertTrue(isSlashCommand(" /model codex/example "))
        assertFalse(isSlashCommand("/home/user/project"))
        assertFalse(isSlashCommand("Please /compact this"))
        assertEquals("details", commandScreen("details"))
        assertEquals("tasks", commandScreen("tasks"))
        assertEquals("subagents", commandScreen("subagents"))
        assertEquals("questions", commandScreen("questions"))
        assertEquals("", commandScreen("unsupported"))
        assertEquals(listOf("help", "model", "permissions", "plan", "compact", "tasks", "agents", "stop"), slashShortcuts)
    }
}
