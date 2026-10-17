package pro.skinnyc.relay

import android.webkit.*
import androidx.compose.material3.MaterialTheme
import org.json.JSONObject
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

/** Bundled OpenUI artifact surface only. The app's navigation, chat and editor remain native.
 * No network, cookies, file access, agent tools, popups, or arbitrary HTML are granted here.
 */
private val artifactStates = java.util.concurrent.ConcurrentHashMap<String, JSONObject>()

@Composable
fun RichArtifact(vm: RelayModel, source: String, id: String, streaming: Boolean = false) {
    val context = LocalContext.current
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val background = MaterialTheme.colorScheme.background.toArgb()
    val accent = "#" + Integer.toHexString(MaterialTheme.colorScheme.primary.toArgb()).padStart(8, '0').takeLast(6)
    val onAccent = "#" + Integer.toHexString(MaterialTheme.colorScheme.onPrimary.toArgb()).padStart(8, '0').takeLast(6)
    val boundSession = vm.selected
    var height by remember(id) { mutableIntStateOf(240) }
    val payload by rememberUpdatedState(json("source" to source.take(100000), "id" to id, "sessionId" to boundSession, "initialState" to (artifactStates[id] ?: JSONObject()), "dark" to dark, "accent" to accent, "onAccent" to onAccent, "streaming" to streaming))
    AndroidView(
        modifier = Modifier.fillMaxWidth().height(height.dp),
        factory = {
            WebView(context).apply {
                setBackgroundColor(background)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.blockNetworkLoads = true
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                settings.setSupportMultipleWindows(false)
                addJavascriptInterface(object {
                    @JavascriptInterface fun action(value: String) {
                        if (value.length <= 32000) post { if (vm.selected == boundSession) vm.edit(if (vm.draft.isBlank()) value else vm.draft + "\n" + value) }
                    }
                    @JavascriptInterface fun state(value: String) {
                        if (value.length <= 64000) runCatching {
                            if (artifactStates.size >= 128 && !artifactStates.containsKey(id)) artifactStates.clear()
                            artifactStates[id] = JSONObject(value)
                        }
                    }
                    @JavascriptInterface fun height(value: Int) { post { height = value.coerceIn(96, 640) } }
                }, "RelayArtifact")
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                        val uri = request.url
                        val path = uri.path.orEmpty()
                        // Only exact read-only media routes from this conversation can serve images.
                        val media = Regex("^/api/sessions/" + Regex.escape(boundSession) + "/(?:attachments/[a-fA-F0-9-]{36}|media/[a-fA-F0-9-]{36}/[0-9]{1,2})$").matches(path)
                        if (uri.scheme == "https" && uri.host == "relay-ui.invalid" && media) {
                            return try {
                                val response = vm.api.client.newCall(vm.api.request(path).build()).execute()
                                val mime = response.header("Content-Type", "").orEmpty().substringBefore(';')
                                if (!response.isSuccessful || !Regex("image/(png|jpeg|webp|gif|avif)").matches(mime)) {
                                    response.close()
                                    WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), java.io.ByteArrayInputStream(byteArrayOf()))
                                } else WebResourceResponse(mime, null, response.body!!.byteStream())
                            } catch (_: Exception) { WebResourceResponse("text/plain", "UTF-8", 503, "Unavailable", emptyMap(), java.io.ByteArrayInputStream(byteArrayOf())) }
                        }
                        val allowed = uri.scheme == "https" && uri.host == "relay-ui.invalid" && (path == "/rich.html" || path.startsWith("/assets/")) && !path.contains("..") && !path.contains('\\')
                        if (!allowed) return WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), java.io.ByteArrayInputStream(byteArrayOf()))
                        return try {
                            val mime = when { path.endsWith(".js") -> "application/javascript"; path.endsWith(".css") -> "text/css"; path.endsWith(".html") -> "text/html"; else -> "application/octet-stream" }
                            WebResourceResponse(mime, "UTF-8", context.assets.open("rich$path"))
                        } catch (_: Exception) { WebResourceResponse("text/plain", "UTF-8", 404, "Not found", emptyMap(), java.io.ByteArrayInputStream(byteArrayOf())) }
                    }
                    override fun onPageFinished(view: WebView, url: String) {
                        if (url == "https://relay-ui.invalid/rich.html") view.evaluateJavascript("window.RelayRich && window.RelayRich.render(${payload});", null)
                    }
                }
                loadUrl("https://relay-ui.invalid/rich.html")
            }
        },
        update = { it.evaluateJavascript("window.RelayRich && window.RelayRich.render(${payload});", null) },
        onRelease = { it.removeJavascriptInterface("RelayArtifact"); it.stopLoading(); it.destroy() },
    )
}

data class RichPart(val kind: String, val text: String)
fun richParts(text: String): List<RichPart> {
    val result = mutableListOf<RichPart>()
    var start = 0
    val pattern = Regex("(?:^|\\n)```openui[^\\S\\n]*\\n([\\s\\S]*?)(?:\\n```(?=\\n|$)|$)")
    pattern.findAll(text).forEach {
        if (it.range.first > start) result.add(RichPart("text", text.substring(start, it.range.first)))
        result.add(RichPart("openui", it.groupValues[1].take(100000)))
        start = it.range.last + 1
    }
    if (start < text.length) result.add(RichPart("text", text.substring(start)))
    return result
}
