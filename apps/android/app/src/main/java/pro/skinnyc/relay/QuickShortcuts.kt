package pro.skinnyc.relay

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun QuickShortcuts(vm: RelayModel, close: () -> Unit) {
    val session = vm.session
    val available = !vm.sending && !vm.working && vm.connected && (session?.can("sendMessage") == true || session?.can("steerActiveTurn") == true)
    AlertDialog(onDismissRequest = close, title = { Text("Quick shortcuts") },
        text = { Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("Stop · Ctrl+C" to "/stop", "Escape · Esc" to "/esc").forEach { (label, line) ->
                OutlinedButton(onClick = { close(); vm.command(line) }, enabled = available && session?.busy == true && session.can("interruptTurn"), modifier = Modifier.fillMaxWidth()) { Text(label) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Yes", "Continue", "No").forEach { text ->
                    FilledTonalButton(onClick = { close(); vm.quickReply(text) }, enabled = available && session?.pending == 0 && session.status != "blocked" && !vm.transcribing && vm.uploading == 0 && session.modes().any { it != "queue" }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 10.dp), modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text(text) }
                }
            }
            if ((session?.pending ?: 0) > 0 || session?.status == "blocked") TextButton(onClick = { close(); vm.commandAction = "questions" }) { Text("Answer current question") }
            slashShortcuts.filter { it != "help" && it != "stop" }.forEach { name ->
                OutlinedButton(onClick = { close(); vm.command("/$name") }, enabled = available, modifier = Modifier.fillMaxWidth()) { Text("/$name") }
            }
        } }, confirmButton = { TextButton(onClick = close) { Text("Close") } })
}
