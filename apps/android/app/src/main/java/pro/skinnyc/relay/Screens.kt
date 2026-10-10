@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package pro.skinnyc.relay

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun Page(title: String, back: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            ActionIcon(Icons.Outlined.ArrowBack, "Back", onClick = back)
            Text(
                title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            content = content,
        )
    }
}

@Composable
fun MediaCard(vm: RelayModel, path: String, name: String, description: String, image: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var expanded by remember { mutableStateOf(false) }
    var scale by remember { mutableFloatStateOf(1f) }
    var failed by remember { mutableStateOf(false) }
    val save =
        rememberLauncherForActivityResult(
            ActivityResultContracts.CreateDocument("application/octet-stream")
        ) { uri ->
            if (uri != null)
                scope.launch {
                    runCatching {
                            val bytes = vm.api.bytes(path)
                            withContext(Dispatchers.IO) {
                                context.contentResolver.openOutputStream(uri)?.use {
                                    it.write(bytes)
                                }
                            }
                        }
                        .onFailure { vm.error = "Download failed: ${it.message}" }
                }
        }
    Column(
        Modifier.fillMaxWidth()
            .padding(vertical = 8.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
    ) {
        if (image && !failed)
            AsyncImage(
                model = vm.api.base + path,
                contentDescription = description.ifBlank { name },
                modifier =
                    Modifier.fillMaxWidth().heightIn(min = 100.dp, max = 340.dp).clickable {
                        expanded = true
                    },
                onError = { failed = true },
            )
        Row(Modifier.padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    name,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelLarge,
                )
                if (failed)
                    Text(
                        "Preview unavailable · download to inspect",
                        style = MaterialTheme.typography.bodySmall,
                    )
                else if (description.isNotBlank())
                    Text(description, maxLines = 2, style = MaterialTheme.typography.bodySmall)
            }
            ActionIcon(Icons.Outlined.Download, "Save $name") { save.launch(name) }
        }
    }
    if (expanded)
        Dialog(
            onDismissRequest = {
                expanded = false
                scale = 1f
            },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                Column(Modifier.safeDrawingPadding()) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        ActionIcon(Icons.Outlined.Close, "Close image") {
                            expanded = false
                            scale = 1f
                        }
                        ActionIcon(Icons.Outlined.Download, "Download image") { save.launch(name) }
                    }
                    Box(
                        Modifier.weight(1f).fillMaxWidth().pointerInput(Unit) {
                            detectTransformGestures { _, _, zoom, _ ->
                                scale = (scale * zoom).coerceIn(1f, 5f)
                            }
                        },
                        contentAlignment = Alignment.Center,
                    ) {
                        AsyncImage(
                            model = vm.api.base + path,
                            contentDescription = description,
                            modifier =
                                Modifier.fillMaxWidth()
                                    .graphicsLayer(scaleX = scale, scaleY = scale),
                        )
                    }
                }
            }
        }
}

@Composable
fun QuestionCard(vm: RelayModel, request: JSONObject) {
    val id = request.str("id")
    val active =
        request.str("status") == "pending" &&
            runCatching { Instant.parse(request.str("expiresAt")).isAfter(Instant.now()) }
                .getOrDefault(false) &&
            (vm.session?.can("answerQuestion") == true || vm.session?.can("approveAction") == true)
    val metadata = request.obj("metadata")
    val dsh = request.str("route") == "dsh-native"
    val questions = if (dsh) metadata.rows("dshQuestions") else metadata.rows("questions")
    val answers = remember(id) { mutableStateMapOf<String, String>() }
    val choices = remember(id) { mutableStateMapOf<String, List<String>>() }
    fun respond(value: Any) {
        vm.operation("/api/interactions/$id/respond", json("response" to value))
    }
    Surface(
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                "Your input is needed",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
            )
            MarkdownText(request.str("prompt"))
            metadata
                .str("command")
                .takeIf { it.isNotBlank() }
                ?.let {
                    SelectionContainerCompat {
                        Text(it, style = MaterialTheme.typography.bodySmall)
                    }
                }
            if (questions.isNotEmpty()) {
                questions.forEach { q ->
                    val qid = q.str("id")
                    val selected = choices[qid] ?: emptyList()
                    if (questions.size > 1)
                        Text(q.str("question"), fontWeight = FontWeight.SemiBold)
                    q.str("detail").takeIf { it.isNotBlank() }?.let { MarkdownText(it) }
                    q.rows("options").forEach { option ->
                        val label = option.str("label")
                        Row(
                            Modifier.fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .clickable(enabled = active && !vm.working) {
                                    choices[qid] =
                                        if (dsh && q.optBoolean("multiSelect")) {
                                            if (label in selected) selected - label
                                            else selected + label
                                        } else listOf(label)
                                    if (!dsh) answers[qid] = label
                                    else if (!q.optBoolean("multiSelect")) answers[qid] = ""
                                }
                                .padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (q.optBoolean("multiSelect"))
                                Checkbox(checked = label in selected, onCheckedChange = null)
                            else RadioButton(selected = label in selected, onClick = null)
                            Column(Modifier.padding(start = 10.dp)) {
                                Text(label)
                                if (option.str("description").isNotBlank())
                                    Text(
                                        option.str("description"),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                            }
                        }
                    }
                    OutlinedTextField(
                        value = answers[qid] ?: "",
                        onValueChange = {
                            answers[qid] = it
                            if (!q.optBoolean("multiSelect")) choices[qid] = emptyList()
                        },
                        label = {
                            Text(
                                if (q.rows("options").isEmpty()) "Your answer" else "Other response"
                            )
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = active && !vm.working,
                        shape = RoundedCornerShape(14.dp),
                    )
                }
                Button(
                    onClick = {
                        if (dsh)
                            respond(
                                json(
                                    "answers" to
                                        JSONArray(
                                            questions.map { q ->
                                                json(
                                                    "id" to q.str("id"),
                                                    "selected" to
                                                        JSONArray(
                                                            choices[q.str("id")]
                                                                ?: emptyList<String>()
                                                        ),
                                                    "custom" to (answers[q.str("id")] ?: ""),
                                                )
                                            }
                                        )
                                )
                            )
                        else
                            respond(
                                json(
                                    "answers" to
                                        JSONObject().apply {
                                            questions.forEach { q ->
                                                put(
                                                    q.str("id"),
                                                    json(
                                                        "answers" to
                                                            JSONArray(
                                                                listOf(answers[q.str("id")] ?: "")
                                                            )
                                                    ),
                                                )
                                            }
                                        }
                                )
                            )
                    },
                    enabled =
                        active &&
                            !vm.working &&
                            questions.all {
                                !answers[it.str("id")].isNullOrBlank() ||
                                    !choices[it.str("id")].isNullOrEmpty()
                            },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) {
                    Text(if (vm.working) "Sending…" else "Send response")
                }
            } else if (request.str("type").endsWith("approval")) {
                request.rows("choices").forEach { option ->
                    OutlinedButton(
                        onClick = { respond(option.str("id")) },
                        enabled = active && !vm.working,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(option.str("label"))
                    }
                }
            } else {
                val multiple = request.str("type") == "multiple-choice"
                request.rows("choices").forEach { option ->
                    val selected = choices["answer"] ?: emptyList()
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable(enabled = active && !vm.working) {
                                choices["answer"] =
                                    if (multiple) {
                                        if (option.str("id") in selected)
                                            selected - option.str("id")
                                        else selected + option.str("id")
                                    } else listOf(option.str("id"))
                                answers["answer"] = option.str("id")
                            }
                            .heightIn(min = 48.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(option.str("id") in selected, onCheckedChange = null)
                        Text(option.str("label"), Modifier.padding(start = 8.dp))
                    }
                }
                if (request.rows("choices").isEmpty())
                    OutlinedTextField(
                        answers["answer"] ?: "",
                        { answers["answer"] = it },
                        label = { Text("Your answer") },
                        enabled = active && !vm.working,
                        modifier = Modifier.fillMaxWidth(),
                    )
                Button(
                    onClick = {
                        respond(
                            if (multiple) JSONArray(choices["answer"] ?: emptyList<String>())
                            else answers["answer"] ?: ""
                        )
                    },
                    enabled =
                        active &&
                            !vm.working &&
                            (!answers["answer"].isNullOrBlank() ||
                                !choices["answer"].isNullOrEmpty()),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Send response")
                }
            }
            if (!active)
                Text(
                    "This request is no longer accepting an answer. Refresh the session.",
                    style = MaterialTheme.typography.bodySmall,
                )
        }
    }
}

@Composable
fun SessionActions(vm: RelayModel, session: Session, close: () -> Unit) {
    var name by remember { mutableStateOf(session.title) }
    var interrupt by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = close) {
        Column(
            Modifier.fillMaxWidth().padding(24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(session.title, style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(
                name,
                { name = it },
                label = { Text("Session name") },
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    vm.operation(
                        "/api/sessions/${session.id}/preferences",
                        json("name" to name),
                        "PATCH",
                    ) {
                        close()
                    }
                },
                enabled = !vm.working && name.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Rename")
            }
            OutlinedButton(
                onClick = {
                    vm.operation(
                        "/api/sessions/${session.id}/preferences",
                        json("pinned" to !session.data.optBoolean("pinned")),
                        "PATCH",
                    ) {
                        close()
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !vm.working,
            ) {
                Text(if (session.data.optBoolean("pinned")) "Unpin" else "Pin session")
            }
            OutlinedButton(
                onClick = {
                    vm.operation(
                        "/api/sessions/${session.id}/preferences",
                        json("archived" to !session.data.optBoolean("archived")),
                        "PATCH",
                    ) {
                        close()
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !vm.working,
            ) {
                Text(
                    if (session.data.optBoolean("archived")) "Restore to inbox"
                    else "Hide from inbox"
                )
            }
            if (session.can("interruptTurn"))
                TextButton(onClick = { interrupt = true }) {
                    Text("Stop current turn", color = MaterialTheme.colorScheme.error)
                }
        }
    }
    if (interrupt)
        AlertDialog(
            onDismissRequest = { interrupt = false },
            title = { Text("Stop the active turn?") },
            text = {
                Text("This interrupts the agent's current work. The Herdr session remains open.")
            },
            confirmButton = {
                TextButton(
                    enabled = !vm.working,
                    onClick = {
                        vm.operation(
                            "/api/sessions/${session.id}/interrupt",
                            json("confirm" to true),
                        ) {
                            interrupt = false
                            close()
                        }
                    },
                ) {
                    Text("Stop turn")
                }
            },
            dismissButton = { TextButton(onClick = { interrupt = false }) { Text("Keep working") } },
        )
}

@Composable
fun SettingsScreen(vm: RelayModel, back: () -> Unit) {
    var endpoint by remember { mutableStateOf(vm.api.base) }
    Page("Settings", back) {
        Text("Connection", style = MaterialTheme.typography.titleMedium)
        Text(
            "Connect Tailscale on this phone. Your tailnet identity authorizes access to Fred; no pairing key is needed.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedTextField(
            endpoint,
            { endpoint = it },
            label = { Text("Gateway HTTPS address") },
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            onClick = {
                runCatching {
                        vm.endpoint(endpoint)
                        back()
                    }
                    .onFailure { vm.error = it.message ?: "Invalid gateway" }
            }
        ) {
            Text("Connect")
        }
        if (vm.error.isNotBlank()) Text(vm.error, color = MaterialTheme.colorScheme.error)
        HorizontalDivider()
        Text("Voice input", style = MaterialTheme.typography.titleMedium)
        Text(
            "Records on this device, then sends audio to your gateway for Gary to transcribe and clean up. Results are inserted into your draft for review. Recordings are deleted after success or cancellation."
        )
        Text("Notifications", style = MaterialTheme.typography.titleMedium)
        Text(
            "Background push notifications are not enabled in this Android build. Your agents continue working when the app is closed."
        )
        Text(
            "Relay Android ${BuildConfig.VERSION_NAME}",
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

@Composable
fun DetailsScreen(vm: RelayModel, back: () -> Unit) {
    val s = vm.session
    var models by remember(s?.id) { mutableStateOf<JSONObject?>(null) }
    var permissions by remember(s?.id) { mutableStateOf<JSONObject?>(null) }
    var agentMode by remember(s?.id) { mutableStateOf<JSONObject?>(null) }
    var settingKind by remember(s?.id) { mutableStateOf("permissions") }
    var settingsReload by remember { mutableStateOf(0) }
    var loadError by remember(s?.id) { mutableStateOf("") }
    var permissionChoice by remember(s?.id) { mutableStateOf<JSONObject?>(null) }
    var actionSheet by remember { mutableStateOf(false) }
    LaunchedEffect(s?.id, settingsReload) {
        if (s != null)
            runCatching {
                    permissions = vm.api.api("/api/sessions/${s.id}/permissions")
                    agentMode = vm.api.api("/api/sessions/${s.id}/mode")
                    if (s.harness == "dsh") models = vm.api.api("/api/sessions/${s.id}/models")
                }
                .onFailure { loadError = it.message ?: "Could not load settings" }
    }
    Page("Session settings", back) {
        if (s == null) Text("Choose a session first.")
        else {
            Text(s.title, style = MaterialTheme.typography.headlineSmall)
            TextButton(onClick = { settingsReload++; loadError = "" }) { Text("Refresh permissions and mode") }
            if (permissions == null && loadError.isBlank()) Text("Loading session permissions…")
            listOf("permissions" to permissions, "mode" to agentMode).forEach { (kind, settings) ->
                settings?.let { catalog ->
                    HorizontalDivider()
                    Text(if (kind == "mode") "Agent mode" else "Permissions", style = MaterialTheme.typography.titleMedium)
                    if (catalog.optBoolean("supported")) {
                        Text("Current: ${catalog.str("currentName").ifBlank { catalog.str("current") }}")
                        catalog.rows("options").forEach { option ->
                            OutlinedButton(
                                enabled = !vm.working && option.str("value") != catalog.str("current"),
                                onClick = { settingKind = kind; permissionChoice = option },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column {
                                    Text(option.str("name"))
                                    if (option.str("description").isNotBlank())
                                        Text(
                                            option.str("description"),
                                            style = MaterialTheme.typography.bodySmall,
                                        )
                                }
                            }
                        }
                    } else Text(catalog.str("reason"), style = MaterialTheme.typography.bodyMedium)
                }
            }
            listOf(
                    "Agent" to s.agent,
                    "Profile" to s.profile,
                    "Model" to s.model,
                    "Host" to s.data.str("hostId"),
                    "Directory" to s.cwd,
                    "State" to status(s.status),
                )
                .filter { it.second.isNotBlank() }
                .forEach { (label, value) ->
                    Column {
                        Text(
                            label,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        SelectionContainerCompat { Text(value) }
                    }
                }
            OutlinedButton(onClick = { actionSheet = true }) {
                Text("Rename, pin or manage session")
            }
            if (loadError.isNotBlank()) Text(loadError, color = MaterialTheme.colorScheme.error)
            if (vm.error.isNotBlank()) Text(vm.error, color = MaterialTheme.colorScheme.error)
            models?.let { catalog ->
                HorizontalDivider()
                Text("Model for next request", style = MaterialTheme.typography.titleMedium)
                val options =
                    catalog.rows("groups").flatMap { group ->
                        group.rows("models").map { model ->
                            json(
                                "id" to "${group.str("id")}/${model.str("id")}",
                                "name" to "${group.str("name")} · ${model.str("name")}",
                                "provider" to group.str("id"),
                                "model" to model.str("id"),
                            )
                        }
                    }
                var chosen by remember { mutableStateOf("") }
                ChoiceField("Model", options, chosen) { chosen = it }
                Button(
                    enabled = !vm.working && chosen.isNotBlank(),
                    onClick = {
                        val choice = options.first { it.str("id") == chosen }
                        vm.operation(
                            "/api/sessions/${s.id}/model",
                            json(
                                "provider" to choice.str("provider"),
                                "model" to choice.str("model"),
                            ),
                        )
                    },
                ) {
                    Text("Apply model")
                }
            }

        }
    }
    if (actionSheet && s != null) SessionActions(vm, s) { actionSheet = false }
    permissionChoice?.let { option ->
        AlertDialog(
            onDismissRequest = { permissionChoice = null },
            title = { Text(if (settingKind == "mode") "Change agent mode?" else "Change agent permissions?") },
            text = { Text("${option.str("name")}\n${option.str("description")}") },
            confirmButton = {
                TextButton(
                    enabled = !vm.working,
                    onClick = {
                        vm.operation(
                            "/api/sessions/${s?.id}/${settingKind}",
                            json(
                                "value" to option.str("value"),
                                "expected" to (if (settingKind == "mode") agentMode else permissions)?.str("current"),
                                "confirm" to true,
                            ),
                        ) {
                            if (settingKind == "mode") agentMode = it else permissions = it
                            permissionChoice = null
                        }
                    },
                ) {
                    Text("Apply settings")
                }
            },
            dismissButton = { TextButton(onClick = { permissionChoice = null }) { Text("Cancel") } },
        )
    }
}

@Composable
fun ChoiceField(
    label: String,
    options: List<JSONObject>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            shape = RoundedCornerShape(14.dp),
        ) {
            Text(
                options.find { it.str("id") == selected }?.str("name")
                    ?: "Choose ${label.lowercase()}",
                Modifier.weight(1f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Icon(Icons.Outlined.ExpandMore, null)
        }
    }
    if (expanded)
        ModalBottomSheet(onDismissRequest = { expanded = false }) {
            var query by remember { mutableStateOf("") }
            Text(
                label,
                Modifier.padding(horizontal = 24.dp),
                style = MaterialTheme.typography.titleLarge,
            )
            OutlinedTextField(
                query,
                { query = it },
                label = { Text("Search") },
                modifier = Modifier.fillMaxWidth().padding(16.dp),
            )
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp).navigationBarsPadding()) {
                items(
                    options.filter { (it.str("name") + it.str("id")).contains(query, true) },
                    key = { it.str("id") },
                ) { option ->
                    ListItem(
                        headlineContent = { Text(option.str("name")) },
                        supportingContent = {
                            option.str("description").takeIf { it.isNotBlank() }?.let { Text(it) }
                        },
                        trailingContent = {
                            if (option.str("id") == selected) Icon(Icons.Outlined.Check, null)
                        },
                        modifier =
                            Modifier.clickable(enabled = !option.optBoolean("unavailable")) {
                                onSelect(option.str("id"))
                                expanded = false
                            },
                    )
                }
            }
        }
}

@Composable
fun QueueScreen(vm: RelayModel, back: () -> Unit) {
    var edit by remember { mutableStateOf<JSONObject?>(null) }
    var prompt by remember { mutableStateOf("") }
    Page("Task queue", back) {
        val s = vm.session
        if (s != null) {
            Text("Follow-ups run in order when the agent is ready.")
            OutlinedButton(
                enabled = !vm.working,
                onClick = {
                    vm.operation(
                        "/api/sessions/${s.id}/queue",
                        json("paused" to !s.data.optBoolean("queuePaused")),
                    )
                },
            ) {
                Text(if (s.data.optBoolean("queuePaused")) "Resume queue" else "Pause queue")
            }
            if (vm.error.isNotBlank()) Text(vm.error, color = MaterialTheme.colorScheme.error)
            if (vm.tasks.isEmpty())
                Text("No queued tasks yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
            vm.tasks.forEach { task ->
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Column(
                        Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            task.str("status"),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Text(task.str("prompt"))
                        if (task.str("error").isNotBlank())
                            Text(task.str("error"), color = MaterialTheme.colorScheme.error)
                        if (task.str("status") == "pending")
                            Row {
                                TextButton(
                                    onClick = {
                                        edit = task
                                        prompt = task.str("prompt")
                                    }
                                ) {
                                    Text("Edit")
                                }
                                TextButton(
                                    enabled = !vm.working,
                                    onClick = {
                                        vm.operation(
                                            "/api/sessions/${s.id}/tasks/${task.str("id")}",
                                            JSONObject(),
                                            "DELETE",
                                        )
                                    },
                                ) {
                                    Text("Cancel")
                                }
                            }
                    }
                }
            }
        }
    }
    edit?.let { task ->
        AlertDialog(
            onDismissRequest = { edit = null },
            title = { Text("Edit queued task") },
            text = { OutlinedTextField(prompt, { prompt = it }) },
            confirmButton = {
                TextButton(
                    enabled = !vm.working && prompt.isNotBlank(),
                    onClick = {
                        vm.operation(
                            "/api/sessions/${vm.selected}/tasks/${task.str("id")}",
                            json("prompt" to prompt),
                            "PATCH",
                        ) {
                            edit = null
                        }
                    },
                ) {
                    Text("Save")
                }
            },
            dismissButton = { TextButton(onClick = { edit = null }) { Text("Cancel") } },
        )
    }
}

@Composable
fun LaunchScreen(vm: RelayModel, back: () -> Unit) {
    val context = LocalContext.current
    val launchPrefs = remember {
        context.getSharedPreferences("relay", android.content.Context.MODE_PRIVATE)
    }
    val pendingLaunch = remember {
        runCatching { JSONObject(launchPrefs.getString("launch.pending", "{}")!!) }
            .getOrDefault(JSONObject())
    }
    var profiles by remember { mutableStateOf(listOf<JSONObject>()) }
    var error by remember { mutableStateOf("") }
    var profileId by rememberSaveable { mutableStateOf("") }
    var permission by rememberSaveable { mutableStateOf("") }
    var permissionConfirmed by rememberSaveable { mutableStateOf(false) }
    var newFolder by remember { mutableStateOf(false) }
    var folderName by rememberSaveable { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var model by rememberSaveable { mutableStateOf("") }
    var preset by rememberSaveable { mutableStateOf("") }
    var cwd by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var prompt by rememberSaveable { mutableStateOf("") }
    var requestId by rememberSaveable {
        mutableStateOf(pendingLaunch.str("requestId").ifBlank { UUID.randomUUID().toString() })
    }
    var receipt by remember { mutableStateOf<JSONObject?>(null) }
    var uncertain by rememberSaveable {
        mutableStateOf(pendingLaunch.str("requestId").isNotBlank())
    }
    var starting by remember { mutableStateOf(false) }
    var folders by remember { mutableStateOf<JSONObject?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        runCatching {
                profiles = vm.api.api("/api/launch/profiles").rows("profiles")
                if (profileId.isBlank()) profileId = profiles.firstOrNull()?.str("id") ?: ""
            }
            .onFailure { error = it.message ?: "Could not load launch profiles" }
    }
    val profile = profiles.find { it.str("id") == profileId }
    LaunchedEffect(receipt?.str("terminalId"), vm.sessions) {
        receipt?.let { r ->
            vm.sessions
                .find {
                    it.data.str("hostId") == r.str("hostId") &&
                        it.data.str("terminalId") == r.str("terminalId") &&
                        !it.data.str("nativeSessionId").startsWith("unbound:")
                }
                ?.let {
                    launchPrefs.edit().remove("launch.pending").apply()
                    vm.choose(it.id)
                    back()
                }
        }
    }
    LaunchedEffect(receipt, uncertain) {
        while (receipt?.str("status") == "starting" || uncertain) {
            delay(2000)
            runCatching {
                    val found = vm.api.api("/api/launch/$requestId")
                    receipt = found
                    uncertain = false
                    vm.reload()
                }
                .onFailure {
                    if (it is ApiFailure && it.status == 404) {
                        error = "No launch receipt found. Check your session list before retrying."
                        launchPrefs.edit().remove("launch.pending").apply()
                        uncertain = false
                    }
                }
        }
    }
    fun browse(path: String? = null) {
        scope.launch {
            runCatching {
                    folders =
                        vm.api.api(
                            "/api/launch/folders?profileId=${encode(profileId)}" +
                                (path?.let { "&path=${encode(it)}" } ?: "")
                        )
                }
                .onFailure { error = it.message ?: "Could not list folders" }
        }
    }
    Page("New session", back) {
        Text("Start on Fred", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Choose the folder and agent. Herdr owns the session, so it keeps working when you leave.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (receipt != null || uncertain || starting) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
            Text(
                receipt?.str("diagnostic")?.ifBlank { "Starting your session…" }
                    ?: "Checking launch delivery…"
            )
        } else {
            ChoiceField(
                "Agent",
                profiles.map { JSONObject(it.toString()).put("name", it.str("label")) },
                profileId,
            ) {
                profileId = it
                model = ""
                permission = ""
                permissionConfirmed = false
                newFolder = false
                preset = ""
                cwd = ""
            }
            if (profile != null) {
                if (profile.rows("agentPresets").isNotEmpty())
                    ChoiceField(
                        "Agent profile",
                        profile.rows("agentPresets"),
                        preset.ifBlank { profile.str("defaultAgentPreset") },
                    ) {
                        preset = it
                    }
                ChoiceField(
                    "Model",
                    profile.rows("models"),
                    model.ifBlank { profile.str("defaultModel") },
                ) {
                    model = it
                }
                if (profile.optBoolean("allowCustomModel"))
                    OutlinedTextField(
                        model,
                        { model = it },
                        label = { Text("Custom model (optional)") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                OutlinedTextField(
                    cwd,
                    { cwd = it },
                    label = { Text("Working directory on Fred") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedButton(onClick = { browse(cwd.takeIf { it.startsWith('/') }) }) {
                    Icon(Icons.Outlined.FolderOpen, null)
                    Text("Browse folders", Modifier.padding(start = 8.dp))
                }
                OutlinedButton(onClick = { newFolder = !newFolder }) { Text("New project folder") }
                if (newFolder) {
                    Text("Create in ${profile.str("projectHome")}")
                    OutlinedTextField(folderName, { folderName = it }, label = { Text("Project folder name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Button(enabled = folderName.isNotBlank() && !creating, onClick = {
                        creating = true
                        scope.launch {
                            runCatching { vm.api.api("/api/launch/folders", "POST", json("profileId" to profileId, "name" to folderName.trim())) }
                                .onSuccess { cwd = it.str("path"); newFolder = false; folderName = ""; error = "" }
                                .onFailure { error = it.message ?: "Could not create folder" }
                            creating = false
                        }
                    }) { Text(if (creating) "Creating…" else "Create and use folder") }
                }
                ChoiceField("Session permissions", listOf(json("id" to "", "name" to "Use host default")) + profile.rows("permissions"), permission) {
                    permission = it; permissionConfirmed = false
                }
                Text(profile.rows("permissions").find { it.str("id") == permission }?.str("description") ?: "Uses the agent’s configured permission policy.", style = MaterialTheme.typography.bodySmall)
                if (permission.isNotBlank()) Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = permissionConfirmed, onCheckedChange = { permissionConfirmed = it })
                    Text("Use these permissions for the new session")
                }
                OutlinedTextField(
                    name,
                    { name = it },
                    label = { Text("Session name (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    prompt,
                    { prompt = it },
                    label = { Text("First instruction") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                )
                Button(
                    enabled = cwd.startsWith('/') && profile.optBoolean("connected") && !starting && !creating && prompt.isNotBlank() && (permission.isBlank() || permissionConfirmed),
                    onClick = {
                        starting = true
                        error = ""
                        scope.launch {
                            try {
                                val launchRequest = json(
                                        "requestId" to requestId,
                                        "profileId" to profileId,
                                        "cwd" to cwd,
                                        "name" to name.ifBlank { cwd.substringAfterLast('/') },
                                        "model" to model,
                                        "permission" to permission.takeIf { it.isNotBlank() },
                                        "permissionConfirmed" to permissionConfirmed,
                                        "prompt" to prompt,
                                        "agentPreset" to
                                            preset
                                                .ifBlank { profile.str("defaultAgentPreset") }
                                                .takeIf { it.isNotBlank() },
                                    )
                                check(
                                    launchPrefs
                                        .edit()
                                        .putString("launch.pending", launchRequest.toString())
                                        .commit()
                                ) {
                                    "Could not preserve launch recovery. No request was sent."
                                }
                                receipt = vm.api.api("/api/launch", "POST", launchRequest)
                                vm.reload()
                            } catch (e: Exception) {
                                error = e.message ?: "Launch failed"
                                uncertain = true
                            } finally {
                                starting = false
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                ) {
                    Text("Start session")
                }
            }
        }
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
    }
    folders?.let { listing ->
        ModalBottomSheet(onDismissRequest = { folders = null }) {
            Column(Modifier.fillMaxWidth().padding(20.dp)) {
                Text(listing.str("path"), style = MaterialTheme.typography.titleMedium)
                Button(
                    onClick = {
                        cwd = listing.str("path")
                        folders = null
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Use this folder")
                }
                listing
                    .str("parent")
                    .takeIf { it.isNotBlank() }
                    ?.let { parent ->
                        TextButton(onClick = { browse(parent) }) { Text("↑ Parent folder") }
                    }
                LazyColumn(Modifier.heightIn(max = 380.dp)) {
                    items(listing.rows("directories"), key = { it.str("path") }) { folder ->
                        ListItem(
                            headlineContent = { Text(folder.str("name")) },
                            leadingContent = { Icon(Icons.Outlined.Folder, null) },
                            modifier = Modifier.clickable { browse(folder.str("path")) },
                        )
                    }
                }
            }
        }
    }
}
