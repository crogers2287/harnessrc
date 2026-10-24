@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package pro.skinnyc.relay

import android.app.Application
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

@Composable
fun HelperDrawer(main: RelayModel, openSession: (String) -> Unit, close: () -> Unit) {
    val context = LocalContext.current
    val helper: RelayModel = viewModel(key = "helper:${main.api.base}", factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            RelayModel(context.applicationContext as Application, "helper.session:${main.api.base}") as T
    })
    val lifecycle = LocalLifecycleOwner.current
    DisposableEffect(helper, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) helper.start()
            if (event == Lifecycle.Event.ON_STOP) helper.stop()
        }
        lifecycle.lifecycle.addObserver(observer)
        if (lifecycle.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) helper.start()
        onDispose { lifecycle.lifecycle.removeObserver(observer); helper.stop() }
    }
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
    suspend fun refresh() {
        state = main.api.api("/api/helper")
        val id = state?.optJSONObject("current")?.str("sessionId").orEmpty()
        if (id.isNotBlank() && helper.selected != id) helper.choose(id)
        val current = state?.optJSONObject("current")
        if (pending.isNotBlank() && current?.str("requestId") == JSONObject(pending).str("requestId") && current.optJSONObject("receipt")?.str("status") in listOf("started", "uncertain")) {
            prefs.edit().remove(pendingKey).commit(); pending = ""; fresh = false
        }
    }
    LaunchedEffect(main.api.base) {
        while (true) {
            try { refresh() } catch (e: Exception) {
                if (e is CancellationException) throw e
                error = e.message ?: "Could not load helper"
            }
            delay(3000)
        }
    }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
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
                    } else if (current != null && !fresh && current.str("sessionId").isNotBlank() && helper.session?.id == current.str("sessionId")) {
                        when (screen) {
                            "questions" -> QuestionsScreen(helper) { screen = "" }
                            "details" -> DetailsScreen(helper, { screen = "tasks" }, { screen = "subagents" }, { screen = "questions" }) { screen = "" }
                            "tasks" -> AgentTasksScreen(helper, { screen = "queue" }, { screen = "subagents" }) { screen = "" }
                            "queue" -> QueueScreen(helper) { screen = "" }
                            "subagents" -> SubagentsScreen(helper) { screen = "tasks" }
                            else -> {
                                if (WindowInsets.ime.getBottom(LocalDensity.current) == 0) Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(helper.session?.data?.str("model").orEmpty(), Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
                                    TextButton(onClick = { screen = "details" }) { Text("Details") }
                                }
                                Chat(helper, Modifier.weight(1f))
                                if (helper.error.isNotBlank()) ErrorNotice(helper.error) { helper.error = "" }
                                AnswerTray(helper) { screen = "questions" }
                                Composer(helper)
                            }
                        }
                        androidx.activity.compose.BackHandler(enabled = screen.isNotEmpty()) { screen = "" }
                    } else Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        if (current != null && !fresh) {
                            Text(if (current.optJSONObject("receipt")?.str("status") == "uncertain") "Launch needs checking" else "Connecting to your helper…")
                            Text(current.optJSONObject("receipt")?.str("diagnostic").orEmpty().ifBlank { "You can close this panel while the native session starts." })
                            TextButton(onClick = { scope.launch { runCatching { refresh() }.onFailure { error = it.message.orEmpty() } } }) { Text("Check status") }
                        } else {
                            Text("Ask about your sessions, check what needs attention, or manage your running agents.")
                            val profiles = state?.rows("profiles").orEmpty()
                            val profile = profiles.find { it.str("id") == profileId } ?: profiles.firstOrNull()
                            val chosenModel = model.ifBlank { profile?.str("defaultModel").orEmpty().ifBlank { profile?.rows("models")?.firstOrNull()?.str("id").orEmpty() } }
                            if (state == null) Text("Loading connections…")
                            else if (profiles.isEmpty()) Text("Enable a helper launch profile on the gateway with your CFR proxy connection and Relay MCP. No host or model is built into the app.")
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
                                            refresh(); helper.reload(); main.reload()
                                        } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: "Launch needs checking" }
                                        finally { busy = false }
                                    }
                                }) { Text(if (busy) "Starting…" else if (pending.isNotBlank()) "Retry same request" else "Start chat") }
                            }
                            if (pending.isNotBlank()) TextButton(enabled = !busy, onClick = { scope.launch {
                                try {
                                    val requestId = JSONObject(pending).str("requestId")
                                    refresh()
                                    if (state?.optJSONObject("current")?.str("requestId") == requestId) { prefs.edit().remove(pendingKey).commit(); pending = ""; fresh = false }
                                    else try { main.api.api("/api/launch/$requestId"); error = "Launch was received. Reopen the helper to check its status." }
                                    catch (e: ApiFailure) { if (e.status == 404) { prefs.edit().remove(pendingKey).commit(); pending = ""; error = "No launch was created. You can edit the settings and try again." } else throw e }
                                }
                                catch (e: Exception) { if (e is CancellationException) throw e; error = e.message.orEmpty() }
                            } }) { Text("Check launch receipt") }
                            if (fresh) TextButton(onClick = { fresh = false }) { Text("Back to conversation") }
                        }
                        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}
