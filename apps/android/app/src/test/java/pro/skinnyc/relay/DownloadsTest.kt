package pro.skinnyc.relay

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class DownloadsTest {
    @Test fun copiesCompleteBinaryBytes() {
        val bytes = byteArrayOf(0x50, 0x4b, 0, 1, 2, 3, 127, -1)
        val output = ByteArrayOutputStream()
        assertEquals(bytes.size.toLong(), copyDownload(ByteArrayInputStream(bytes), output, bytes.size.toLong()))
        assertArrayEquals(bytes, output.toByteArray())
    }
    @Test fun rejectsEmptyAndIncompleteFilesBeforeSave() {
        for ((bytes, length) in listOf(byteArrayOf() to 0L, byteArrayOf(1, 2) to 5L)) {
            try { copyDownload(ByteArrayInputStream(bytes), ByteArrayOutputStream(), length); fail("Expected incomplete/empty download rejection") }
            catch (expected: IllegalStateException) { assertTrue(expected.message!!.isNotBlank()) }
        }
    }
}
