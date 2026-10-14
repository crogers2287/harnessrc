package pro.skinnyc.relay

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.util.UUID

@Composable
fun ProviderSwapForm(vm: RelayModel, session: Session, close: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("provider-swaps", 0) }
    val key = "swap.${session.id}"
    var pending by remember { mutableStateOf(runCatching { prefs.getString(key, null)?.let(::JSONObject) }.getOrNull()) }
    var catalog by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }
    var profileId by rememberSaveable { mutableStateOf("") }
    var model by rememberSaveable { mutableStateOf("") }
    var permission by rememberSaveable { mutableStateOf("") }
    var confirmed by rememberSaveable { mutableStateOf(false) }
    var receipt by remember { mutableStateOf<JSONObject?>(null) }
    var checking by remember { mutableStateOf(false) }
    var rejected by remember { mutableStateOf(false) }
    var missing by remember { mutableStateOf(false) }
    LaunchedEffect(session.id) {
        try { catalog = vm.api.api("/api/sessions/${session.id}/provider-swap") }
        catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: "Could not load providers" }
    }
    LaunchedEffect(pending?.str("requestId"), checking) {
        val request = pending ?: return@LaunchedEffect
        do {
            try {
                receipt = vm.api.api("/api/sessions/${session.id}/provider-swap/${request.str("requestId")}")
                missing = false
                if (receipt?.str("status") == "started") vm.reload()
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                missing = e is ApiFailure && e.status == 404
                if (!missing) error = e.message ?: "Could not check restart"
            }
            if (receipt?.str("status") != "restarting") break
            delay(2000)
        } while (true)
        checking = false
    }
    fun send(request: JSONObject) {
        pending = request
        // Commit before any lifecycle request; closing this sheet cannot lose the request ID.
        prefs.edit().putString(key, request.toString()).commit()
        rejected = false; error = ""
        vm.operation("/api/sessions/${session.id}/provider-swap", request,
            failure = { e ->
                error = e.message ?: "Restart delivery is not confirmed"
                rejected = e is ApiFailure && e.status in listOf(400, 409, 422)
                checking = true
            },
            done = { result -> receipt = result; checking = true }
        )
    }
    Text("Swap provider", style = MaterialTheme.typography.titleMedium)
    if (pending != null) {
        Text(receipt?.str("diagnostic")?.ifBlank { "Resuming conversation…" } ?: "Checking restart. The original request is retained.")
        if (vm.working || receipt?.str("status") == "restarting") LinearProgressIndicator(Modifier.fillMaxWidth())
        OutlinedButton(onClick = { checking = true }, enabled = !vm.working, modifier = Modifier.fillMaxWidth()) { Text("Check restart") }
        if (receipt == null) OutlinedButton(onClick = { pending?.let { send(it) } }, enabled = !vm.working, modifier = Modifier.fillMaxWidth()) { Text("Retry same request") }
        if (rejected && missing) OutlinedButton(onClick = { prefs.edit().remove(key).commit(); pending = null; confirmed = false }, modifier = Modifier.fillMaxWidth()) { Text("Edit choices") }
        if (receipt?.str("status") == "started") Button(onClick = { prefs.edit().remove(key).commit(); close() }, modifier = Modifier.fillMaxWidth()) { Text("Return to conversation") }
    } else if (catalog == null && error.isBlank()) {
        LinearProgressIndicator(Modifier.fillMaxWidth())
    } else if (catalog?.optBoolean("supported") != true) {
        Text(catalog?.str("reason") ?: "Provider restart unavailable")
    } else {
        val profiles = catalog!!.rows("profiles")
        val profile = profiles.find { it.str("id") == profileId } ?: profiles.firstOrNull()
        Text("Resume this conversation in ${session.cwd} with a different provider and model.")
        ChoiceField("Provider", profiles.map { json("id" to it.str("id"), "name" to "${it.str("provider")} · ${it.str("label")}") }, profile?.str("id") ?: "") { profileId = it; model = ""; permission = ""; confirmed = false }
        val models = profile?.rows("models") ?: emptyList()
        val selectedModel = model.ifBlank { profile?.str("defaultModel")?.ifBlank { models.firstOrNull()?.str("id") ?: "" } ?: "" }
        ChoiceField("Model", models, selectedModel) { model = it; confirmed = false }
        if (profile?.optBoolean("allowCustomModel") == true) OutlinedTextField(selectedModel, { model = it; confirmed = false }, label = { Text("Model ID") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        val permissions = profile?.rows("permissions") ?: emptyList()
        if (permissions.isNotEmpty()) ChoiceField("Permissions after restart", permissions, permission) { permission = it; confirmed = false }
        Text("The current process closes after it is idle. History stays; queued work pauses for review.", style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(confirmed, { confirmed = it })
            Text("Restart with this provider, model and permissions", Modifier.weight(1f))
        }
        if (session.busy) Text("Finish or stop the current turn and resolve questions first.")
        Button(onClick = {
            send(json("requestId" to UUID.randomUUID().toString(), "generation" to catalog!!.str("generation"), "profileId" to profile!!.str("id"), "model" to selectedModel, "permission" to permission.takeIf { it.isNotBlank() }, "confirm" to true))
        }, enabled = !vm.working && confirmed && !session.busy && session.status in listOf("idle", "done") && profile?.optBoolean("connected") == true && selectedModel.isNotBlank() && (permissions.isEmpty() || permission.isNotBlank()), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Restart and resume") }
    }
    if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
}
