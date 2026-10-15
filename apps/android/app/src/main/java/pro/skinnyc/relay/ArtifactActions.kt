package pro.skinnyc.relay

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID
import kotlinx.coroutines.*

fun previewableText(name: String) = Regex("\\.(txt|md|json|csv|log|ya?ml|xml|html?|css|[cm]?jsx?|tsx?|py|go|rs|sh|kt|java|sql|toml)$", RegexOption.IGNORE_CASE).containsMatchIn(name)

@Composable
fun ArtifactActions(vm: RelayModel, path: String, name: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var preview by remember { mutableStateOf<String?>(null) }
    val save = LocalFileSaver.current
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (previewableText(name)) TextButton(enabled = !busy, onClick = {
            busy = true; error = ""
            scope.launch {
                try {
                    val bytes = vm.api.bytes(path)
                    preview = bytes.take(262144).toByteArray().toString(Charsets.UTF_8) + if (bytes.size > 262144) "\n\nPreview limited to 256 KB. Download for the complete file." else ""
                } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: "Preview failed" }
                finally { busy = false }
            }
        }) { Text("Preview file") }
        TextButton(enabled = !busy, onClick = {
            busy = true; error = ""
            scope.launch {
                try {
                    val root = File(context.cacheDir, "shared").apply { mkdirs() }
                    withContext(Dispatchers.IO) {
                        val cutoff = System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000
                        root.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.deleteRecursively() }
                    }
                    val folder = File(root, UUID.randomUUID().toString()).apply { mkdirs() }
                    val file = File(folder, File(name).name.ifBlank { "attachment" })
                    vm.api.downloadTo(path, file)
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                    val mime = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "application/octet-stream"
                    val intent = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    intent.clipData = android.content.ClipData.newRawUri(name, uri)
                    context.startActivity(Intent.createChooser(intent, "Share $name"))
                } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: "Sharing failed" }
                finally { busy = false }
            }
        }) { Text(if (busy) "Preparing…" else "Share file") }
    }
    if (error.isNotBlank()) Text(error, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error)
    preview?.let { text ->
        Dialog(onDismissRequest = { preview = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Surface(Modifier.fillMaxSize()) {
                Column(Modifier.safeDrawingPadding().padding(16.dp)) {
                    Row(Modifier.fillMaxWidth()) {
                        TextButton(onClick = { preview = null }) { Text("Close preview") }
                        TextButton(onClick = { save(path, name) }) { Text("Download") }
                    }
                    Text(name, style = MaterialTheme.typography.titleMedium)
                    Box(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                        SelectionContainerCompat { Text(text, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium) }
                    }
                }
            }
        }
    }
}
