package pro.skinnyc.relay

import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns
import org.junit.Assert.*
import org.junit.Test

class TailnetDnsTest {
    private val unavailable = object : Dns { override fun lookup(hostname: String): List<InetAddress> = throw UnknownHostException("System DNS unavailable") }
    @Test fun pinsOnlyTheProvisionedHostAfterDnsFailure() {
        val dns = TailnetDns("server.example.ts.net", "100.77.12.34", unavailable)
        assertEquals("100.77.12.34", dns.lookup("server.example.ts.net").single().hostAddress)
        assertEquals("server.example.ts.net", dns.lookup("server.example.ts.net").single().hostName)
        for (host in listOf("another.example.ts.net", "evil.test")) {
            try { dns.lookup(host); fail("An unrelated host must not use the pin") } catch (_: UnknownHostException) {}
        }
    }
    @Test fun preservesSuccessfulResolutionAndRejectsNonTailnetPins() {
        val resolved = listOf(InetAddress.getByAddress(byteArrayOf(100, 65, 1, 2)))
        assertEquals(resolved, TailnetDns("server", "100.77.12.34", object : Dns { override fun lookup(hostname: String) = resolved }).lookup("server"))
        for (ip in listOf("127.0.0.1", "100.128.1.2", "100.98.999.42", "100.98.invalid.154.42", "")) {
            try { TailnetDns("server", ip, unavailable).lookup("server"); fail("Invalid pin") } catch (_: UnknownHostException) {}
        }
    }

    @Test fun validatesAnyHttpsGatewayAndOptionalTailnetFallback() {
        assertEquals("https://relay.example.test:11543", gatewayOrigin(" https://relay.example.test:11543/ "))
        assertEquals("https://my-server.tailnet.ts.net", gatewayOrigin("https://my-server.tailnet.ts.net"))
        for (url in listOf("", "http://relay.example.test", "https://user:pass@relay.example.test", "https://relay.example.test/api", "https://relay.example.test?x=1", "https://relay.example.test#fragment")) {
            try { gatewayOrigin(url); fail("Invalid gateway: $url") } catch (_: IllegalArgumentException) {}
        }
        validateTailnetIp("")
        validateTailnetIp("100.77.12.34")
        for (ip in listOf("127.0.0.1", "100.128.0.1", "100.77.bad.12.34")) {
            try { validateTailnetIp(ip); fail("Invalid fallback: $ip") } catch (_: IllegalArgumentException) {}
        }
    }
}
