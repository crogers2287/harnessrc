package pro.skinnyc.relay

import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns

/** DNS-only fallback for the provisioned gateway. URL, TLS hostname and trust remain unchanged. */
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
