package pro.skinnyc.relay

import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** DNS-only fallback for the configured gateway. URL, TLS hostname and trust remain unchanged. */
class TailnetDns(private val gatewayHost: String, private val address: String, private val system: Dns = Dns.SYSTEM) : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
        try { return system.lookup(hostname) }
        catch (failure: UnknownHostException) {
            if (gatewayHost.isBlank() || !hostname.equals(gatewayHost, ignoreCase = true)) throw failure
            val parts = address.split('.')
            if (parts.size != 4) throw failure
            val octets = parts.mapNotNull { it.toIntOrNull()?.takeIf { n -> n in 0..255 } }
            if (octets.size != 4 || octets[0] != 100 || octets[1] !in 64..127) throw failure
            return listOf(InetAddress.getByAddress(hostname, octets.map { it.toByte() }.toByteArray()))
        }
    }
}

/** Accept a server origin only; credentials and paths must never become request prefixes. */
fun gatewayOrigin(value: String): String {
    val url = value.trim().toHttpUrlOrNull()
    require(url != null && url.isHttps && url.username.isEmpty() && url.password.isEmpty() &&
        url.encodedPath == "/" && url.query == null && url.fragment == null) {
        "Use an HTTPS gateway origin without credentials or a path."
    }
    return url.toString().trimEnd('/')
}

fun validateTailnetIp(address: String) {
    if (address.isBlank()) return
    val parts = address.split('.').mapNotNull { it.toIntOrNull()?.takeIf { n -> n in 0..255 } }
    require(address.split('.').size == 4 && parts.size == 4 && parts[0] == 100 && parts[1] in 64..127) {
        "Use the Relay server’s Tailscale IPv4 address (100.64–100.127), or leave it blank."
    }
}
