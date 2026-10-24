@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package pro.skinnyc.relay

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.input.key.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

@Composable
fun HelperDrawer(main: RelayModel, openSession: (String) -> Unit, close: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("relay", Context.MODE_PRIVATE) }
    val pendingKey = "helper.pending:${main.api.base}"
    val draftKey = "helper.prompt:${main.api.base}"
    var pending by remember { mutableStateOf(prefs.getString(pendingKey, "")!!) }
    var prompt by remember { mutableStateOf(prefs.getString(draftKey, "")!!) }
    var state by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var fresh by rememberSaveable { mutableStateOf(false) }
    var profileId by rememberSaveable { mutableStateOf("") }
    var model by rememberSaveable { mutableStateOf("") }
    var screen by rememberSaveable { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    suspend fun refresh() {
        state = main.api.api("/api/helper")
        val current = state?.optJSONObject("current")
        if (pending.isNotBlank() && current?.str("requestId") == JSONObject(pending).str("requestId") && current.optJSONObject("receipt")?.str("status") in listOf("started", "uncertain")) {
            prefs.edit().remove(pendingKey).commit(); pending = ""; fresh = false
        }
    }
    LaunchedEffect(main.api.base, lifecycle) {
      lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
        while (true) {
            try { refresh() } catch (e: Exception) {
                if (e is CancellationException) throw e
                error = e.message ?: "Could not load helper"
            }
            delay(1000)
        }
      }
    }
    androidx.activity.compose.BackHandler(onBack = close)
        Box(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .4f)).clickable(onClick = close))
            Surface(Modifier.align(Alignment.CenterEnd).widthIn(max = 560.dp).fillMaxWidth().fillMaxHeight()) {
                Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Relay helper", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                        TextButton(onClick = { screen = if (screen == "attention") "" else "attention" }) { Text("Waiting (${state?.optJSONObject("attention")?.rows("items")?.size ?: 0})") }
                        if (state?.optJSONObject("current") != null && !fresh)
                            TextButton(onClick = { fresh = true; screen = "" }) { Text("New chat") }
                        ActionIcon(Icons.Outlined.Close, "Close helper", onClick = close)
                    }
                    HorizontalDivider()
                    val current = state?.optJSONObject("current")
                    if (screen == "attention") Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text("Sessions needing input", style = MaterialTheme.typography.titleLarge)
                        val attention = state?.optJSONObject("attention")
                        Text(if (attention?.optBoolean("enabled") == true) "One reminder after ${attention.optInt("waitingMinutes")} minutes of waiting. Enable background notifications in Settings to receive alerts." else "Background reminders are disabled on this gateway.")
                        val items = attention?.rows("items").orEmpty()
                        if (items.isEmpty()) Text("No sessions are waiting for an answer.")
                        items.forEach { item -> OutlinedButton(onClick = { openSession(item.str("sessionId")) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("${item.str("name")} · waiting ${item.optInt("waitingMinutes")} min") } }
                        TextButton(onClick = { screen = "" }) { Text("Back to helper") }
                        androidx.activity.compose.BackHandler { screen = "" }
                    } else if (current != null && !fresh) {
                        PrivateHelperChat(main, current, Modifier.weight(1f)) { scope.launch { runCatching { refresh() }.onFailure { error = it.message.orEmpty() } } }
                    } else Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        if (current != null && !fresh) {
                            Text(if (current.optJSONObject("receipt")?.str("status") == "uncertain") "Request needs checking" else "Connecting to your helper…")
                            Text(current.optJSONObject("receipt")?.str("diagnostic").orEmpty().ifBlank { "You can close this panel while the native session starts." })
                            TextButton(onClick = { scope.launch { runCatching { refresh() }.onFailure { error = it.message.orEmpty() } } }) { Text("Check status") }
                        } else {
                            Text("Ask about your sessions, check what needs attention, or manage your running agents.")
                            val profiles = state?.rows("profiles").orEmpty()
                            val profile = profiles.find { it.str("id") == profileId } ?: profiles.firstOrNull()
                            val chosenModel = model.ifBlank { profile?.str("defaultModel").orEmpty().ifBlank { profile?.rows("models")?.firstOrNull()?.str("id").orEmpty() } }
                            if (state == null) Text("Loading connections…")
                            else if (profiles.isEmpty()) Text("Configure a helper connection on the gateway with your proxy URL and models. No host or model is built into the app.")
                            else {
                                if (!busy && pending.isBlank()) {
                                    ChoiceField("Connection", profiles.map { json("id" to it.str("id"), "name" to "${it.str("label")} · ${it.str("provider")}") }, profile?.str("id").orEmpty()) { profileId = it; model = "" }
                                    ChoiceField("Model", profile?.rows("models").orEmpty(), chosenModel) { model = it }
                                    if (profile?.optBoolean("allowCustomModel") == true)
                                        OutlinedTextField(chosenModel, { model = it }, label = { Text("Model ID") }, modifier = Modifier.fillMaxWidth())
                                }
                                OutlinedTextField(prompt, { prompt = it; prefs.edit().putString(draftKey, it).apply() }, label = { Text("Message") }, minLines = 3, enabled = !busy && pending.isBlank(), modifier = Modifier.fillMaxWidth())
                                Button(enabled = !busy && profile?.optBoolean("connected") == true && chosenModel.isNotBlank() && prompt.isNotBlank(), onClick = {
                                    scope.launch {
                                        busy = true; error = ""
                                        try {
                                            val body = if (pending.isNotBlank()) JSONObject(pending) else json("requestId" to UUID.randomUUID().toString(), "profileId" to profile!!.str("id"), "model" to chosenModel, "prompt" to prompt, "replace" to fresh)
                                            check(prefs.edit().putString(pendingKey, body.toString()).commit()) { "Could not preserve launch recovery. Nothing was sent." }
                                            pending = body.toString()
                                            main.api.api("/api/helper", "POST", body)
                                            prefs.edit().remove(pendingKey).remove(draftKey).commit(); pending = ""; prompt = ""; fresh = false
                                            refresh()
                                        } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: "Request needs checking" }
                                        finally { busy = false }
                                    }
                                }) { Text(if (busy) "Starting…" else if (pending.isNotBlank()) "Retry same request" else "Start chat") }
                            }
                            if (pending.isNotBlank()) TextButton(enabled = !busy, onClick = { scope.launch {
                                try {
                                    val requestId = JSONObject(pending).str("requestId")
                                    refresh()
                                    if (state?.optJSONObject("current")?.str("requestId") == requestId) { prefs.edit().remove(pendingKey).commit(); pending = ""; fresh = false }
                                    else { error = "No receipt is visible yet. Retry the same request to check delivery." }
                                }
                                catch (e: Exception) { if (e is CancellationException) throw e; error = e.message.orEmpty() }
                            } }) { Text("Check request receipt") }
                            if (fresh) TextButton(onClick = { fresh = false }) { Text("Back to conversation") }
                        }
                        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
}

@Composable
private fun PrivateHelperChat(main: RelayModel, current: JSONObject, modifier: Modifier, refresh: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("relay", Context.MODE_PRIVATE) }
    val key = "helper.message:${main.api.base}:${current.str("id")}"
    var draft by remember(key) { mutableStateOf(prefs.getString(key, "").orEmpty()) }
    var pending by remember(key) { mutableStateOf(prefs.getString("$key:pending", "").orEmpty()) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val running = current.str("status") == "running"
    val scroll = rememberScrollState()
    val messages = current.rows("messages")
    LaunchedEffect(messages.size, messages.lastOrNull()?.str("content"), running) { scroll.animateScrollTo(scroll.maxValue) }
    fun stop() { scope.launch { try { main.api.api("/api/helper/stop", "POST"); refresh() } catch(e: Exception) { if(e is CancellationException) throw e; error = e.message.orEmpty() } } }
    fun send() {
        if(sending || running || (draft.isBlank() && pending.isBlank())) return
        scope.launch {
            sending = true; error = ""
            try {
                val body = if(pending.isNotBlank()) JSONObject(pending) else json("requestId" to UUID.randomUUID().toString(), "conversationId" to current.str("id"), "prompt" to draft)
                check(prefs.edit().putString("$key:pending", body.toString()).commit()) { "Could not preserve request. Nothing was sent." }
                pending = body.toString()
                main.api.api("/api/helper/messages", "POST", body)
                prefs.edit().remove("$key:pending").remove(key).commit(); pending = ""; draft = ""; refresh()
            } catch(e: Exception) { if(e is CancellationException) throw e; error = e.message.orEmpty() }
            finally { sending = false }
        }
    }
    Column(modifier.fillMaxWidth()) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            messages.forEach { message ->
                Surface(color = if(message.str("role") == "user") MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text(if(message.str("role") == "user") "You" else "Relay helper", style = MaterialTheme.typography.labelMedium)
                        MarkdownText(message.str("content"), main.api.base)
                    }
                }
            }
            Text(if(running) "Working…" else current.str("error"), style = MaterialTheme.typography.bodySmall)
        }
        HorizontalDivider()
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if(error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            OutlinedTextField(draft, { draft = it; prefs.edit().putString(key, it).apply() }, label = { Text("Message") }, enabled = !sending && pending.isBlank(), modifier = Modifier.fillMaxWidth().onPreviewKeyEvent { event ->
                if(event.type != KeyEventType.KeyDown) false
                else if(event.key == Key.Escape && running) { stop(); true }
                else if(event.key == Key.Enter && event.isCtrlPressed) { draft += "\n"; prefs.edit().putString(key, draft).apply(); true }
                else if(event.key == Key.Enter && !event.isShiftPressed) { send(); true }
                else false
            }, minLines = 2, maxLines = 5, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Send), keyboardActions = androidx.compose.foundation.text.KeyboardActions(onSend = { send() }))
            if(running && draft.isBlank()) Button(onClick = { stop() }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Stop") }
            else Button(enabled = !sending && !running && (draft.isNotBlank() || pending.isNotBlank()), onClick = { send() }, modifier = Modifier.heightIn(min = 48.dp)) { Text(if(pending.isNotBlank()) "Retry same request" else if(sending) "Sending…" else "Send") }
            Text("${current.str("model")} · ${current.optJSONObject("usage")?.optLong("total")?.let { "$it tokens" } ?: "Usage unavailable"} · App agent", style = MaterialTheme.typography.labelSmall)
        }
    }
}
