package pro.skinnyc.relay

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.Instant
import kotlinx.coroutines.delay
import org.json.JSONObject

fun actionableRequest(request: JSONObject, now: Long): Boolean =
    request.str("status") in listOf("pending", "responding", "uncertain") &&
        runCatching { Instant.parse(request.str("expiresAt")).toEpochMilli() > now }.getOrDefault(false)

@Composable
fun currentRequests(vm: RelayModel): List<JSONObject> {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }
    return vm.interactions.filter { actionableRequest(it, now) }
}

@Composable
fun AnswerTray(vm: RelayModel, open: () -> Unit) {
    val requests = currentRequests(vm)
    if (requests.isNotEmpty()) OutlinedButton(onClick = open, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp).heightIn(min = 56.dp)) {
        Icon(Icons.Outlined.HelpOutline, null)
        Text("Needs your answer · ${requests.size}", Modifier.weight(1f).padding(horizontal = 12.dp))
        Icon(Icons.Outlined.ChevronRight, null)
    }
}

@Composable
fun QuestionsScreen(vm: RelayModel, back: () -> Unit) {
    val requests = currentRequests(vm)
    Page("Needs your answer", back) {
        if (requests.isEmpty()) Text("No unanswered requests. You’re all caught up.")
        requests.forEach { request -> key(request.str("id")) { QuestionCard(vm, request) } }
    }
}
