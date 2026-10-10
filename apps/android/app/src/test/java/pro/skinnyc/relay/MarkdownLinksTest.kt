package pro.skinnyc.relay

import org.junit.Assert.*
import org.junit.Test

class MarkdownLinksTest {
    @Test
    fun resolvesDownloadsButRejectsExecutableAndLocalSchemes() {
        val base = "https://relay.example"
        assertEquals(
            "https://relay.example/api/android/apk",
            resolveChatLink(base, "/api/android/apk"),
        )
        assertEquals(
            "https://example.com/file.zip",
            resolveChatLink(base, "https://example.com/file.zip"),
        )
        listOf(
                "javascript:alert(1)",
                "intent://app",
                "file:///etc/passwd",
                "content://private",
                "https://user:pass@example.com",
            )
            .forEach { assertNull(it, resolveChatLink(base, it)) }
    }
}
