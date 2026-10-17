package pro.skinnyc.relay

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import java.time.Instant

@Composable
fun ActiveToolActivity(vm: RelayModel) {
    val active = remember(vm.events) { activeToolCalls(vm.events) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(vm.selected) {
        while (true) { now = System.currentTimeMillis(); delay(1000) }
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(if ((vm.session?.pending ?: 0) > 0) "Waiting for your answer" else "${vm.session?.agent} is working", style = MaterialTheme.typography.bodyMedium)
        if (vm.session?.status == "working") {
            active.forEach { event ->
                val seconds = runCatching { ((now - Instant.parse(event.data.str("timestamp")).toEpochMilli()) / 1000).coerceAtLeast(0) }.getOrDefault(0)
                Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("${event.body.str("tool", "Tool")} · ${seconds / 60}m ${seconds % 60}s", style = MaterialTheme.typography.titleSmall)
                        val command = toolCommand(event)
                        if (command.isNotBlank()) SelectionContainerCompat {
                            Text(command, Modifier.heightIn(max = 160.dp).verticalScroll(rememberScrollState()), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                        }
                        Text("No tool result received yet.", style = MaterialTheme.typography.bodySmall)
                        if (vm.terminalOutput.isNotBlank()) SelectionContainerCompat {
                            Text(vm.terminalOutput, Modifier.heightIn(max = 200.dp).verticalScroll(rememberScrollState()), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                        }
                        if (seconds >= 30 && vm.terminalOutput.isBlank()) Text("The tool may still be running or waiting for terminal input. Live terminal output is not available here. You can stop the turn to regain control.", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            if (active.isNotEmpty() && vm.session?.can("interruptTurn") == true) OutlinedButton(
                onClick = { vm.command("/stop") }, enabled = vm.connected && !vm.sending && !vm.working,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text("Stop current turn") }
        }
    }
}
