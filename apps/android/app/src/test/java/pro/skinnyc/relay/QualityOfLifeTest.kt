package pro.skinnyc.relay

import org.junit.Assert.*
import org.junit.Test

class QualityOfLifeTest {
    @Test fun expiredOrAnsweredRequestsAreNotActionable() {
        val request = json("status" to "pending", "expiresAt" to "2026-10-15T00:00:00Z")
        val deadline = java.time.Instant.parse(request.str("expiresAt")).toEpochMilli()
        assertTrue(actionableRequest(request, deadline - 1))
        assertFalse(actionableRequest(request, deadline))
        request.put("status", "responded")
        assertFalse(actionableRequest(request, deadline - 1))
        request.put("status", "pending").put("expiresAt", "invalid")
        assertFalse(actionableRequest(request, deadline - 1))
    }
    @Test fun previewsTreatCodeAndDocumentsAsTextAndNeverExecuteThem() {
        assertTrue(previewableText("report.md"))
        assertTrue(previewableText("example.html"))
        assertTrue(previewableText("result.JSON"))
        assertFalse(previewableText("photo.png"))
        assertFalse(previewableText("archive.zip"))
    }
}
