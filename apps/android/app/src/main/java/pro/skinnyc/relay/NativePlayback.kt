package pro.skinnyc.relay

import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** Native media playback stays on the authenticated tailnet ingress. Never auto-plays. */
@Composable
fun NativePlayback(vm: RelayModel, path: String, name: String, fullscreen: Boolean = false) {
    var started by remember(path) { mutableStateOf(false) }
    var expanded by remember(path) { mutableStateOf(false) }
    var error by remember(path) { mutableStateOf(false) }
    val audio = mediaType(name) == "audio"
    Column(Modifier.fillMaxWidth().padding(12.dp)) {
        if (!started || error) {
            Button(onClick = { error = false; started = true }) { Text(if (error) "Retry playback" else "Play ${if (audio) "audio" else "video"}") }
        } else {
            AndroidView(
                modifier = Modifier.fillMaxWidth().height(if (audio) 96.dp else if (fullscreen) 420.dp else 240.dp),
                factory = { context ->
                    VideoView(context).apply {
                        val controls = MediaController(context)
                        controls.setAnchorView(this)
                        setMediaController(controls)
                        setVideoURI(Uri.parse(vm.api.base + path), mapOf("Origin" to vm.api.base, "X-RC-Client" to "android"))
                        setOnPreparedListener { start(); controls.show(0) }
                        setOnErrorListener { _, _, _ -> error = true; true }
                    }
                },
                onRelease = { it.stopPlayback() },
            )
        }
        if (!audio && !fullscreen) TextButton(onClick = { expanded = true; started = false }) { Text("Fullscreen") }
        if (error) Text("Playback unavailable. Download the file or check Tailscale.")
    }
    if (expanded) Dialog(onDismissRequest = { expanded = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.safeDrawingPadding()) {
                TextButton(onClick = { expanded = false }) { Text("Close video") }
                NativePlayback(vm, path, name, true)
            }
        }
    }
}
