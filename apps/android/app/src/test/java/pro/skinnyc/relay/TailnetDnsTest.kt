package pro.skinnyc.relay

import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns
import org.junit.Assert.*
import org.junit.Test

class TailnetDnsTest {
    private val unavailable = object : Dns { override fun lookup(hostname: String): List<InetAddress> = throw UnknownHostException("System DNS unavailable") }
    @Test fun pinsOnlyTheProvisionedHostAfterDnsFailure() {
        val dns = TailnetDns("server.example.ts.net", "100.98.154.42", unavailable)
        assertEquals("100.98.154.42", dns.lookup("server.example.ts.net").single().hostAddress)
        assertEquals("server.example.ts.net", dns.lookup("server.example.ts.net").single().hostName)
        for (host in listOf("another.example.ts.net", "evil.test")) {
            try { dns.lookup(host); fail("An unrelated host must not use the pin") } catch (_: UnknownHostException) {}
        }
    }
    @Test fun preservesSuccessfulResolutionAndRejectsNonTailnetPins() {
        val resolved = listOf(InetAddress.getByAddress(byteArrayOf(100, 65, 1, 2)))
        assertEquals(resolved, TailnetDns("server", "100.98.154.42", object : Dns { override fun lookup(hostname: String) = resolved }).lookup("server"))
        for (ip in listOf("127.0.0.1", "100.128.1.2", "100.98.999.42", "100.98.invalid.154.42", "")) {
            try { TailnetDns("server", ip, unavailable).lookup("server"); fail("Invalid pin") } catch (_: UnknownHostException) {}
        }
    }
}
