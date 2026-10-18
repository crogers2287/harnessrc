package pro.skinnyc.relay

import org.junit.Assert.*
import org.junit.Test

class ConversationFilesTest {
    @Test fun nativeIndicesMatchWebAndFilesAreNotBrowserLinks() {
        val body = json("text" to "[Video](/work/cut.mp4) ![Image](/work/a.png) [Image](/work/a.png) [Plan](/work/plan.json)\n```text\n[Private](/work/private.json)\n```")
        assertEquals(listOf("/work/a.png", "/work/cut.mp4", "/work/plan.json"), conversationFiles("assistant.message", body).map { it.str("path") })
        assertTrue(conversationFiles("user.message", body).isEmpty())
        assertTrue(conversationFiles("tool.output", body).isEmpty())
        assertEquals("video", mediaType("movie.mp4"))
        assertEquals("audio", mediaType("song.mp3"))
    }
    @Test fun explicitOpenUiDoesNotReplaceOrdinaryMarkdown() {
        val parts = richParts("Before\n```openui\nroot = Stack([])\n```\nAfter")
        assertEquals(listOf("text", "openui", "text"), parts.map { it.kind })
        assertEquals("root = Stack([])", parts[1].text)
        assertEquals("text", richParts("```js\nalert(1)\n```")[0].kind)
    }
}
