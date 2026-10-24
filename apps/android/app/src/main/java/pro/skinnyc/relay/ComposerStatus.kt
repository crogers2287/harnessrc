package pro.skinnyc.relay

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.NumberFormat

private fun counter(value: JSONObject?, key: String): String =
    if (value == null || !value.has(key) || value.isNull(key)) "Not reported"
    else NumberFormat.getIntegerInstance().format(value.optLong(key))

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComposerStatus(vm: RelayModel) {
    val session = vm.session ?: return
    var models by remember(session.id) { mutableStateOf<JSONObject?>(null) }
    var permissions by remember(session.id) { mutableStateOf<JSONObject?>(null) }
    var mode by remember(session.id) { mutableStateOf<JSONObject?>(null) }
    var usage by remember(session.id) { mutableStateOf<JSONObject?>(null) }
    var panel by remember(session.id) { mutableStateOf("") }
    var revision by remember { mutableIntStateOf(0) }
    var loadError by remember(session.id) { mutableStateOf("") }
    LaunchedEffect(session.id, session.data.str("generation"), session.data.optBoolean("connected"), session.can("changeModel"), revision) {
        var cycle = 0
        while (true) {
            if (session.data.optBoolean("connected")) {
                try {
                    usage = vm.api.api("/api/sessions/${session.id}/usage")
                    if (cycle % 6 == 0) {
                        if (session.can("changeModel")) models = vm.api.api("/api/sessions/${session.id}/models")
                        permissions = vm.api.api("/api/sessions/${session.id}/permissions")
                        mode = vm.api.api("/api/sessions/${session.id}/mode")
                    }
                    loadError = ""
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    loadError = e.message ?: "Could not load native settings"
                }
            }
            cycle++
            delay(10000)
        }
    }
    val current = models?.optJSONObject("current") ?: models?.optJSONObject("default")
    val usageText = if (usage?.optBoolean("supported") == true) {
        val key = if (usage?.has("contextUsed") == true) "contextUsed" else "total"
        "${counter(usage, key)}${if (usage?.has("contextWindow") == true) " / ${counter(usage, "contextWindow")}" else ""} tokens"
    } else "Tokens: not reported"
    LazyRow(Modifier.fillMaxWidth().semantics { contentDescription = "Native session settings" }, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        item { TextButton(onClick = { panel = "usage" }, modifier = Modifier.heightIn(min = 48.dp)) { Text(usageText, style = MaterialTheme.typography.labelMedium) } }
        item { TextButton(onClick = { panel = "model" }, modifier = Modifier.heightIn(min = 48.dp).widthIn(max = 240.dp)) { Text("Model: ${current?.str("model")?.ifBlank { session.model } ?: session.model}", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium) } }
        item { TextButton(onClick = { panel = "thinking" }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Think: ${current?.str("reasoningEffort")?.ifBlank { "Default" } ?: "Not exposed"}", style = MaterialTheme.typography.labelMedium) } }
        item { TextButton(onClick = { panel = "permissions" }, modifier = Modifier.heightIn(min = 48.dp)) { Text(permissions?.str("currentName")?.ifBlank { permissions?.str("current") ?: "" }?.ifBlank { "Permissions: not exposed" } ?: "Permissions: not exposed", style = MaterialTheme.typography.labelMedium) } }
        if (mode?.optBoolean("supported") == true) item { TextButton(onClick = { panel = "mode" }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Mode: ${mode?.str("currentName")?.ifBlank { mode?.str("current") ?: "" }}", style = MaterialTheme.typography.labelMedium) } }
    }
    if (panel.isNotBlank()) ModalBottomSheet(onDismissRequest = { panel = "" }) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).navigationBarsPadding().imePadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(when (panel) { "usage" -> "Token usage"; "thinking" -> "Thinking level"; "model" -> "Model"; "mode" -> "Agent mode"; else -> "Permissions" }, style = MaterialTheme.typography.titleLarge)
            when {
                panel == "usage" -> if (usage?.optBoolean("supported") == true) {
                    Text("Current context: ${counter(usage, "contextUsed")}${if (usage?.has("contextWindow") == true) " of ${counter(usage, "contextWindow")}" else ""}")
                    Text("Session input: ${counter(usage, "input")}\nSession output: ${counter(usage, "output")}\nSession total: ${counter(usage, "total")}${if (usage?.optBoolean("partial") == true) " (retained history)" else ""}")
                    Text("Native reported counters. Context use and accumulated session use are different measurements.", style = MaterialTheme.typography.bodySmall)
                } else Text(usage?.str("reason")?.ifBlank { loadError } ?: loadError.ifBlank { "Waiting for native usage counters." })
                panel == "model" || panel == "thinking" -> if (models != null) NativeModelControls(vm, session, models!!) { revision++; vm.reload() }
                    else {
                        Text(loadError.ifBlank { "This harness does not expose live model or thinking changes." })
                        if (panel == "model") ProviderSwapForm(vm, session) { panel = "" }
                    }
                else -> NativePolicyControls(vm, session, panel, if (panel == "mode") mode else permissions) { revision++; vm.reload() }
            }
            TextButton(onClick = { panel = "" }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Close session settings") }
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun NativeModelControls(vm: RelayModel, session: Session, catalog: JSONObject, saved: () -> Unit) {
    val current = catalog.optJSONObject("current") ?: catalog.obj("default")
    fun selection(provider: String, model: String) = json("provider" to provider, "model" to model).toString()
    var choice by remember(session.id) { mutableStateOf(selection(current.str("provider"), current.str("model"))) }
    var effort by remember(session.id) { mutableStateOf(current.str("reasoningEffort")) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val entries = catalog.rows("groups").flatMap { group -> group.rows("models").map { model ->
        json("id" to selection(group.str("id"), model.str("id")), "name" to "${group.str("name")} · ${model.str("name")}", "native" to model)
    } }.toMutableList()
    if (entries.none { it.str("id") == choice }) entries.add(json("id" to choice, "name" to JSONObject(choice).str("model")))
    val model = entries.find { it.str("id") == choice }?.obj("native") ?: JSONObject()
    val efforts = model.optJSONArray("reasoningEfforts")
    Text(catalog.str("reason").ifBlank { "Applies to the next model request. A running request keeps its current settings." }, style = MaterialTheme.typography.bodySmall)
    ChoiceField("Native model", entries, choice) { if (!busy) { choice = it; effort = entries.find { row -> row.str("id") == it }?.obj("native")?.str("defaultReasoningEffort") ?: ""; notice = "" } }
    if (efforts != null && efforts.length() > 0) ChoiceField("Thinking level", listOf(json("id" to "", "name" to "Harness default")) + (0 until efforts.length()).map { json("id" to efforts.getString(it), "name" to efforts.getString(it)) }, effort) { if (!busy) { effort = it; notice = "" } }
    else Text("This model does not expose selectable thinking levels.", style = MaterialTheme.typography.bodySmall)
    Button(enabled = !busy && session.data.optBoolean("connected") && session.can("changeModel"), onClick = {
        busy = true
        scope.launch {
            try {
                val body = JSONObject(choice).apply { if (effort.isNotBlank()) put("reasoningEffort", effort) }
                vm.api.api("/api/sessions/${session.id}/model", "POST", body, session.data.str("generation"))
                notice = "Native model settings saved."
                saved()
            } catch (e: Exception) { if (e is CancellationException) throw e; notice = e.message ?: "Could not change model" }
            finally { busy = false }
        }
    }, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (busy) "Applying…" else "Apply model settings") }
    if (notice.isNotBlank()) Text(notice)
}

@Composable
private fun NativePolicyControls(vm: RelayModel, session: Session, kind: String, settings: JSONObject?, saved: () -> Unit) {
    if (settings?.optBoolean("supported") != true) { Text(settings?.str("reason")?.ifBlank { "This harness does not expose these settings." } ?: "Waiting for native settings."); return }
    var choice by remember(settings.toString()) { mutableStateOf(settings.str("current")) }
    var confirmed by remember(choice) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    Text(settings.str("note").ifBlank { settings.str("reason") }.ifBlank { "Controls this agent's subsequent turns." }, style = MaterialTheme.typography.bodySmall)
    ChoiceField(if (kind == "mode") "Mode" else "Permission preset", settings.rows("options").map { json("id" to it.str("value"), "name" to it.str("name")) }, choice) { if (!busy) choice = it }
    if (choice != settings.str("current")) {
        Row { Checkbox(confirmed, { confirmed = it }, enabled = !busy); Text("Apply this change to this session", Modifier.padding(top = 12.dp)) }
        Button(enabled = confirmed && !busy && session.data.optBoolean("connected"), onClick = {
            busy = true
            scope.launch {
                try {
                    vm.api.api("/api/sessions/${session.id}/$kind", "POST", json("value" to choice, "expected" to settings.str("current"), "confirm" to confirmed), session.data.str("generation"))
                    notice = "Settings saved in the harness."
                    saved()
                } catch (e: Exception) { if (e is CancellationException) throw e; notice = e.message ?: "Could not change settings" }
                finally { busy = false }
            }
        }, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (busy) "Applying…" else "Apply settings") }
    }
    if (notice.isNotBlank()) Text(notice)
}
