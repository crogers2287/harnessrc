package pro.skinnyc.relay

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import java.io.InputStream
import java.io.OutputStream

/** Fail before a save is offered when the source is empty or truncated. */
fun copyDownload(input: InputStream, output: OutputStream, expectedSize: Long = -1): Long {
    val copied = input.copyTo(output)
    if (copied == 0L) error("The file is empty; nothing was saved")
    if (expectedSize >= 0 && copied != expectedSize) error("The download was incomplete; try again")
    output.flush()
    return copied
}

data class PreparedDownload(val file: String, val name: String, val stage: String = "ready", val uri: String = "")
val LocalFileSaver = staticCompositionLocalOf<(String, String) -> Unit> { error("File saving must be hosted at the app root") }

@Composable
fun DownloadController(vm: RelayModel, content: @Composable () -> Unit) {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri: Uri? -> vm.savePreparedDownload(uri) }
    val pending = vm.preparedDownload
    LaunchedEffect(pending?.file, pending?.stage) {
        if (pending?.stage == "ready") {
            vm.markDownloadChoosing()
            launcher.launch(pending.name)
        }
    }
    CompositionLocalProvider(LocalFileSaver provides { path, name -> vm.prepareDownload(path, name) }, content = content)
}
