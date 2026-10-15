@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.ExperimentalFoundationApi::class,
)

package pro.skinnyc.relay

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.*
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import coil.compose.AsyncImage
import io.noties.markwon.Markwon
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun ActionIcon(icon: ImageVector, label: String, enabled: Boolean = true, onClick: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    IconButton(onClick = { haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress); onClick() }, enabled = enabled, modifier = Modifier.size(48.dp)) {
        Icon(icon, label, modifier = Modifier.size(23.dp))
    }
}

@Composable
fun RelayApp(
    vm: RelayModel,
    shared: Intent?,
    nativeKeyboardVisible: Boolean,
    consumeShare: () -> Unit,
) {
    val density = LocalDensity.current
    val nativeHaptics = LocalHapticFeedback.current
    val feedback = remember(vm.haptics, nativeHaptics) {
        object : androidx.compose.ui.hapticfeedback.HapticFeedback {
            override fun performHapticFeedback(hapticFeedbackType: androidx.compose.ui.hapticfeedback.HapticFeedbackType) {
                if (vm.haptics) nativeHaptics.performHapticFeedback(hapticFeedbackType)
            }
        }
    }
    CompositionLocalProvider(LocalDensity provides Density(density.density, density.fontScale * vm.textScale), LocalHapticFeedback provides feedback) {
        DownloadController(vm) { RelayAppContent(vm, shared, nativeKeyboardVisible, consumeShare) }
    }
}

@Composable
private fun RelayAppContent(vm: RelayModel, shared: Intent?, nativeKeyboardVisible: Boolean, consumeShare: () -> Unit) {
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val conversationState = androidx.compose.runtime.saveable.rememberSaveableStateHolder()
    var screen by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(vm.notificationTarget, vm.sessions) {
        vm.notificationTarget?.let { (id, question) ->
            if (vm.sessions.any { it.id == id }) {
                vm.choose(id)
                screen = if (question) "questions" else ""
                vm.notificationTarget = null
            }
        }
    }
    var rowActions by remember { mutableStateOf<Session?>(null) }
    var confirmShare by remember(shared) { mutableStateOf(shared != null) }
    val context = LocalContext.current
    BackHandler(enabled = screen.isNotEmpty()) { screen = "" }
    BackHandler(enabled = screen.isEmpty()) {
        scope.launch {
            if (drawer.targetValue == DrawerValue.Closed) drawer.open() else drawer.close()
        }
    }
    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet(modifier = Modifier.widthIn(max = 340.dp).fillMaxHeight()) {
                Row(
                    Modifier.fillMaxWidth().padding(start = 22.dp, top = 12.dp, end = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "Relay",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            if (vm.connected) "Connected to Fred" else "Reconnecting…",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    ActionIcon(Icons.Outlined.Close, "Close sessions") {
                        scope.launch { drawer.close() }
                    }
                }
                FilledTonalButton(
                    onClick = {
                        screen = "new"
                        scope.launch { drawer.close() }
                    },
                    modifier =
                        Modifier.fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 14.dp)
                            .heightIn(min = 48.dp),
                ) {
                    Icon(Icons.Outlined.Add, null)
                    Spacer(Modifier.width(8.dp))
                    Text("New session")
                }
                var query by rememberSaveable { mutableStateOf("") }
                var agent by rememberSaveable { mutableStateOf("All") }
                var showSaved by rememberSaveable { mutableStateOf(false) }
                OutlinedTextField(
                    query,
                    { query = it },
                    placeholder = { Text("Search sessions or folders") },
                    leadingIcon = { Icon(Icons.Outlined.Search, null) },
                    singleLine = true,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                )
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(listOf("All") + vm.sessions.map { it.agent }.distinct().sorted()) { name
                        ->
                        FilterChip(
                            selected = agent == name,
                            onClick = { agent = name },
                            label = { Text(name) },
                        )
                    }
                }
                val rows =
                    vm.sessions
                        .filter { s ->
                            (agent == "All" || s.agent == agent) &&
                                (showSaved ||
                                    (!s.data.optBoolean("archived") &&
                                        s.status != "ended" &&
                                        s.data.str("presence") != "saved")) &&
                                (s.title + s.cwd + s.subtitle + s.data.str("hostId")).contains(
                                    query,
                                    true,
                                )
                        }
                        .let { sortedSessions(it, vm.lastOpenedAt) }
                LazyColumn(Modifier.weight(1f)) {
                    if (rows.isEmpty())
                        item {
                            Text(
                                "No matching sessions",
                                Modifier.padding(24.dp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    items(rows, key = { it.id }) { s ->
                        Column(
                            Modifier.fillMaxWidth()
                                .padding(horizontal = 8.dp, vertical = 2.dp)
                                .clip(RoundedCornerShape(16.dp))
                                .background(
                                    if (s.id == vm.selected)
                                        MaterialTheme.colorScheme.primaryContainer
                                    else MaterialTheme.colorScheme.surface
                                )
                                .combinedClickable(
                                    onClick = {
                                        vm.choose(s.id)
                                        screen = ""
                                        scope.launch { drawer.close() }
                                    },
                                    onLongClick = { rowActions = s },
                                )
                                .padding(14.dp)
                        ) {
                            Row {
                                Text(
                                    s.title,
                                    Modifier.weight(1f),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                if (s.pending > 0) Badge { Text("${s.pending}") }
                            }
                            Text(
                                listOf(s.agent, s.profile, s.data.str("hostId"))
                                    .filter { it.isNotBlank() }
                                    .joinToString(" · "),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary,
                            )
                            Text(
                                s.cwd,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                sessionRecencyLabel(s, vm.lastOpenedAt),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(
                                Modifier.padding(top = 5.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(status(s.status), style = MaterialTheme.typography.labelSmall)
                                if (s.queued > 0)
                                    Text(
                                        "${s.queued} queued",
                                        style = MaterialTheme.typography.labelSmall,
                                    )
                            }
                        }
                    }
                }
                Row(
                    Modifier.fillMaxWidth().padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = { showSaved = !showSaved }) {
                        Text(if (showSaved) "Hide saved" else "Show saved")
                    }
                    Spacer(Modifier.weight(1f))
                    ActionIcon(Icons.Outlined.Settings, "Settings") {
                        screen = "settings"
                        scope.launch { drawer.close() }
                    }
                }
            }
        },
    ) {
        Surface(Modifier.fillMaxSize()) {
            when (screen) {
                "settings" -> SettingsScreen(vm) { screen = "" }
                "new" -> LaunchScreen(vm, showSessions = { screen = ""; scope.launch { drawer.open() } }) { screen = "" }
                "details" -> DetailsScreen(vm, openTasks = { screen = "tasks" }, openSubagents = { screen = "subagents" }, openQuestions = { screen = "questions" }) { screen = "" }
                "questions" -> QuestionsScreen(vm) { screen = "" }
                "subagents" -> SubagentsScreen(vm) { screen = "tasks" }
                "tasks" -> AgentTasksScreen(vm, openQueue = { screen = "queue" }, openSubagents = { screen = "subagents" }) { screen = "" }
                "queue" -> QueueScreen(vm) { screen = "" }
                else ->
                    Column(
                        Modifier.fillMaxSize()
                            .statusBarsPadding()
                            .navigationBarsPadding()
                            .imePadding()
                    ) {
                        val keyboard =
                            nativeKeyboardVisible ||
                                WindowInsets.ime.getBottom(LocalDensity.current) > 0
                        if (!keyboard) {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                ActionIcon(Icons.Outlined.Menu, "Open sessions") {
                                    scope.launch { drawer.open() }
                                }
                                Column(
                                    Modifier.weight(1f)
                                        .clip(RoundedCornerShape(12.dp))
                                        .clickable { screen = "details" }
                                        .padding(6.dp)
                                ) {
                                    Text(
                                        vm.session?.title ?: "Your agents",
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        vm.session?.subtitle ?: "Relay",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                ActionIcon(Icons.Outlined.Checklist, "Agent tasks") {
                                    screen = "tasks"
                                }
                                ActionIcon(Icons.Outlined.MoreHoriz, "Session details") {
                                    screen = "details"
                                }
                            }
                        }
                        if (!vm.connected)
                            Row(
                                Modifier.fillMaxWidth()
                                    .background(MaterialTheme.colorScheme.surfaceVariant)
                                    .padding(horizontal = 16.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    "Connecting · check Tailscale",
                                    Modifier.weight(1f),
                                    style = MaterialTheme.typography.labelMedium,
                                )
                                TextButton(onClick = vm::reload) { Text("Retry") }
                            }
                        if (vm.session == null)
                            Box(
                                Modifier.weight(1f).fillMaxWidth(),
                                contentAlignment = Alignment.Center,
                            ) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    if (vm.loading) CircularProgressIndicator()
                                    else {
                                        Text(
                                            "Your agents, wherever you are",
                                            style = MaterialTheme.typography.titleLarge,
                                        )
                                        TextButton(onClick = { scope.launch { drawer.open() } }) {
                                            Text("Choose a session")
                                        }
                                    }
                                }
                            }
                        else conversationState.SaveableStateProvider(vm.selected) { Chat(vm, Modifier.weight(1f)) }
                        if (vm.error.isNotBlank())
                            ErrorNotice(vm.error, onDismiss = { vm.error = "" })
                        if (vm.session != null) {
                            AnswerTray(vm) { screen = "questions" }
                            Composer(vm)
                        }
                    }
            }
        }
    }
    if (vm.preparingDownload) AlertDialog(onDismissRequest = vm::cancelDownloadPreparation, title = { Text("Preparing download") }, text = { LinearProgressIndicator(Modifier.fillMaxWidth()) }, confirmButton = {}, dismissButton = { TextButton(onClick = vm::cancelDownloadPreparation) { Text("Cancel") } })
    rowActions?.let { s -> SessionActions(vm, vm.sessions.find { it.id == s.id } ?: s) { rowActions = null } }
    if (confirmShare && shared != null)
        AlertDialog(
            onDismissRequest = {
                confirmShare = false
                consumeShare()
            },
            title = { Text("Add to this conversation?") },
            text = {
                Text(
                    "Shared content will be added to ${vm.session?.title ?: "the selected session"} as a draft. Nothing is sent automatically."
                )
            },
            confirmButton = {
                TextButton(
                    enabled = vm.session != null,
                    onClick = {
                        shared.getStringExtra(Intent.EXTRA_TEXT)?.let {
                            vm.edit((vm.draft + "\n" + it).trim())
                        }
                        @Suppress("DEPRECATION")
                        val single = shared.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                        @Suppress("DEPRECATION")
                        val multiple =
                            shared.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
                                ?: arrayListOf()
                        (listOfNotNull(single) + multiple).distinct().take(10).forEach {
                            vm.addUri(it, shared)
                        }
                        confirmShare = false
                        consumeShare()
                    },
                ) {
                    Text("Add to draft")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        confirmShare = false
                        consumeShare()
                    }
                ) {
                    Text("Cancel")
                }
            },
        )
}

fun status(value: String) =
    when (value) {
        "working" -> "Working"
        "blocked" -> "Needs your answer"
        "idle" -> "Ready"
        "done" -> "Finished"
        "offline" -> "Disconnected"
        "ended" -> "Ended"
        else -> "Checking status"
    }

@Composable
fun ErrorNotice(text: String, onDismiss: () -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .background(MaterialTheme.colorScheme.errorContainer)
            .padding(start = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text,
            Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onErrorContainer,
            style = MaterialTheme.typography.bodySmall,
        )
        ActionIcon(Icons.Outlined.Close, "Dismiss error", onClick = onDismiss)
    }
}

@Composable
fun Chat(vm: RelayModel, modifier: Modifier) {
    val rows = remember(vm.events) { conversationRows(vm.events) }
    val groups = remember(rows, vm.activityDetail) {
        when (vm.activityDetail) {
            "responses" -> rows.filterNot { isGroupedActivity(it) }.map { listOf(it) }
            "everything" -> rows.map { listOf(it) }
            else -> groupConversationActivity(rows)
        }
    }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var follow by rememberSaveable(vm.selected) { mutableStateOf(true) }
    // Only a user's scroll can change follow intent. Programmatic scrolling and
    // incoming layout changes must never turn it back on while reading history.
    val readerScroll =
        remember(vm.selected, list) {
            object : NestedScrollConnection {
                override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                    if (source == NestedScrollSource.Drag && available.y != 0f) follow = false
                    return Offset.Zero
                }
            }
        }
    LaunchedEffect(
        rows.lastOrNull()?.id,
        rows.lastOrNull()?.text,
        vm.interactions.map { it.str("id") to it.str("status") },
        vm.session?.status,
    ) {
        if (follow) {
            delay(60)
            if (follow && !list.isScrollInProgress && list.layoutInfo.totalItemsCount > 0)
                list.scrollToItem(list.layoutInfo.totalItemsCount - 1)
        }
    }
    Box(modifier.fillMaxWidth()) {
        LazyColumn(
            state = list,
            modifier = Modifier.fillMaxSize().nestedScroll(readerScroll)
                .pointerInput(vm.selected) {
                    awaitEachGesture {
                        // Pause before touch slop/drag recognition, including selectable text.
                        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                        follow = false
                    }
                }.testTag("conversation"),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(if (vm.compactSpacing) 8.dp else 20.dp),
        ) {
            if (vm.hasOlder)
                item("older") { TextButton(onClick = vm::older) { Text("Load earlier messages") } }
            items(groups, key = { it.first().id }) { group ->
                if (vm.activityDetail == "grouped" && isGroupedActivity(group.first())) ActivityGroup(vm, group)
                else Message(vm, group.first())
            }
            items(
                vm.interactions.filter {
                    it.str("status") in listOf("pending", "responding", "uncertain")
                },
                key = { "question:${it.str("id")}" },
            ) {
                QuestionCard(vm, it)
            }
            vm.outgoing?.let { pending ->
                item("delivery") {
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
                        Surface(
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            shape = RoundedCornerShape(22.dp, 22.dp, 6.dp, 22.dp),
                            modifier = Modifier.widthIn(max = 620.dp).fillMaxWidth(0.9f),
                        ) {
                            Text(
                                pending.str("prompt"),
                                Modifier.padding(16.dp),
                                style = MaterialTheme.typography.bodyLarge,
                            )
                        }
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Outlined.Check,
                            null,
                            Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            when (pending.str("state")) {
                                "sending" -> "Sending…"
                                "uncertain" -> "Delivery not confirmed"
                                else -> "Delivered · waiting for agent response"
                            },
                            Modifier.weight(1f).padding(start = 8.dp),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (pending.str("state") == "uncertain")
                            TextButton(enabled = !vm.sending, onClick = vm::retrySend) {
                                Text("Retry safely")
                            }
                        }
                        if (pending.str("state") == "uncertain") {
                            var dismiss by remember(pending.str("idempotencyKey")) { mutableStateOf(false) }
                            TextButton(enabled = !vm.sending, onClick = { dismiss = true }) { Text("Keep draft / clear notice") }
                            if (dismiss) AlertDialog(
                                onDismissRequest = { dismiss = false },
                                title = { Text("Clear delivery notice?") },
                                text = { Text("The agent may have received this message. Your draft stays editable; check the conversation before sending the same instruction again. This does not resend anything.") },
                                confirmButton = { TextButton(onClick = { vm.dismissUncertain(pending.str("idempotencyKey")); dismiss = false }) { Text("Keep draft") } },
                                dismissButton = { TextButton(onClick = { dismiss = false }) { Text("Cancel") } },
                            )
                        }
                    }
                }
            }
            if (vm.session?.busy == true)
                item("working") {
                    Row(
                        Modifier.padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Text(
                            if (vm.session?.pending ?: 0 > 0) "Waiting for your answer"
                            else "${vm.session?.agent} is working",
                            Modifier.padding(start = 12.dp),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            if (rows.isEmpty())
                item("empty") {
                    Column(
                        Modifier.fillMaxWidth().padding(top = 70.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            "${vm.session?.agent ?: "Agent"}, at your fingertips",
                            style = MaterialTheme.typography.titleLarge,
                        )
                        Text(
                            vm.session?.cwd ?: "",
                            Modifier.padding(top = 12.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        vm.session
                            ?.data
                            ?.str("diagnostic")
                            ?.takeIf { it.isNotBlank() }
                            ?.let {
                                Text(
                                    it,
                                    Modifier.padding(top = 12.dp),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                    }
                }
        }
        if (list.canScrollForward)
            SmallFloatingActionButton(
                onClick = {
                    follow = true
                    scope.launch {
                        list.animateScrollToItem(
                            (list.layoutInfo.totalItemsCount - 1).coerceAtLeast(0)
                        )
                    }
                },
                modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp),
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Icon(Icons.Outlined.ArrowDownward, "Latest messages")
            }
    }
}

@Composable
fun Message(vm: RelayModel, event: ChatEvent) {
    val user = event.kind == "user.message"
    val notice = if (user) taskNotice(event.text) else null
    if (notice != null) {
        var expanded by remember(event.id) { mutableStateOf(false) }
        Column {
            TextButton(onClick = { expanded = !expanded }) {
                Icon(if (expanded) Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight, null)
                Text(notice.title)
            }
            Text(notice.summary, style = MaterialTheme.typography.bodyMedium)
            MessageTime(event, "Received")
            if (expanded)
                notice.details.forEach { (label, value) ->
                    Text(
                        label,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    SelectionContainerCompat {
                        Text(value, style = MaterialTheme.typography.bodySmall)
                    }
                }
        }
        return
    }
    val activity =
        event.kind.startsWith("tool.") ||
            event.kind in listOf("diff", "file.change", "reasoning.summary")
    if (activity) {
        var expanded by remember(event.id) { mutableStateOf(false) }
        Column {
            Row(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .clickable { expanded = !expanded }
                    .heightIn(min = 48.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    if (expanded) Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight,
                    null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    event.body.str("tool").ifBlank { event.kind.replace('.', ' ') },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (expanded)
                SelectionContainerCompat {
                    Text(
                        event.text.ifBlank { event.body.toString(2) }.take(24000),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
        }
        return
    }
    val native = conversationFiles(event.kind, event.body)
    val saveFile = LocalFileSaver.current
    var text = displayText(event.text)
    Regex("!\\[([^]]*)]\\(<?(/[^\\s<>]+?)>?(?:\\s+\"[^\"]*\")?\\)").findAll(event.text).forEach {
        if (native.any { file -> file.str("path") == it.groupValues[2] }) text = text.replace(it.value, "")
    }
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (user) Alignment.End else Alignment.Start,
    ) {
        Column(
            Modifier.widthIn(max = if (user) 620.dp else 820.dp)
                .then(
                    if (user)
                        Modifier.padding(start = 26.dp)
                            .clip(RoundedCornerShape(22.dp, 22.dp, 6.dp, 22.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .padding(16.dp)
                    else Modifier
                )
        ) {
            if (event.kind == "artifact.created" && event.body.str("openui").isNotBlank()) RichArtifact(vm, event.body.str("openui"), event.id)
            val parts = if (user) listOf(RichPart("text", text)) else richParts(text)
            parts.forEachIndexed { partIndex, part ->
                if (part.kind == "openui") RichArtifact(vm, part.text, "${event.id}:$partIndex", event.kind == "assistant.delta")
                else {
            if (part.text.isNotBlank()) MarkdownText(part.text, vm.api.base) { link ->
                val index = native.indexOfFirst { it.str("path") == link || android.net.Uri.encode(it.str("path"), "/") == link }
                if (index < 0) false else {
                    saveFile("/api/sessions/${vm.selected}/media/${event.id}/$index", native[index].str("path").substringAfterLast('/'))
                    true
                }
            }
                }
            }
            native.forEachIndexed { index, item ->
                MediaCard(
                    vm,
                    "/api/sessions/${vm.selected}/media/${event.id}/$index",
                    item.str("path").substringAfterLast('/'),
                    item.str("description"),
                    Regex("\\.(png|jpe?g|webp|gif|avif)$", RegexOption.IGNORE_CASE)
                        .containsMatchIn(item.str("path")),
                )
            }
            val attached = event.body.optJSONArray("attachments") ?: JSONArray()
            for (i in 0 until attached.length()) {
                val value = attached.opt(i)
                val obj = value as? JSONObject
                val id = obj?.str("id") ?: value.toString()
                if (id.matches(Regex("[a-fA-F0-9-]{36}")))
                    MediaCard(
                        vm,
                        "/api/sessions/${vm.selected}/attachments/$id",
                        obj?.str("name") ?: "Attachment",
                        "",
                        obj?.str("mime")?.startsWith("image/") == true,
                    )
            }
        }
        val context = LocalContext.current
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                if (!user)
                    Text(
                        vm.session?.agent ?: "Agent",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                MessageTime(event, if (user) "Delivered" else "Received")
                if (user && vm.events.any { it.sequence > event.sequence && it.kind in listOf("assistant.message", "assistant.delta") }) Text("Agent responded", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            ActionIcon(Icons.Outlined.ContentCopy, "Copy message") {
                (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("Message", text))
            }
        }
    }
}

@Composable
fun ActivityGroup(vm: RelayModel, events: List<ChatEvent>) {
    var expanded by rememberSaveable(events.first().id) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" }
                .clickable(role = androidx.compose.ui.semantics.Role.Button) { expanded = !expanded }
                .heightIn(min = 48.dp)
                .padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                if (expanded) Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight,
                null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "Agent activity · ${events.size}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (expanded) Column(Modifier.padding(start = 12.dp)) {
            events.forEach { event -> key(event.id) { Message(vm, event) } }
        }
    }
}

@Composable
fun MessageTime(event: ChatEvent, direction: String) {
    messageTimestamp(event.data.str("timestamp"))?.let { time ->
        Text(
            "$direction · $time",
            modifier = Modifier.padding(vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun SelectionContainerCompat(content: @Composable () -> Unit) {
    androidx.compose.foundation.text.selection.SelectionContainer(content = content)
}

@Composable
fun MarkdownText(text: String, baseUrl: String = RelayApi.DEFAULT_ENDPOINT, onNativeLink: (String) -> Boolean = { false }) {
    val context = LocalContext.current
    val nativeLink by rememberUpdatedState(onNativeLink)
    val renderer =
        remember(context, baseUrl) {
            Markwon.builder(context)
                .usePlugin(
                    object : io.noties.markwon.AbstractMarkwonPlugin() {
                        override fun configureConfiguration(
                            builder: io.noties.markwon.MarkwonConfiguration.Builder
                        ) {
                            builder.linkResolver { view, link ->
                                if (!nativeLink(link)) openChatLink(view.context, baseUrl, link)
                            }
                        }
                    }
                )
                .usePlugin(TablePlugin.create(context))
                .usePlugin(StrikethroughPlugin.create())
                .build()
        }
    val color = MaterialTheme.colorScheme.onSurface.toArgb()
    val scaledTextPx = with(LocalDensity.current) { 17.sp.toPx() }
    AndroidView(
        factory = {
            SelectableMarkdownView(it).apply {
                textSize = 17f
                setTextIsSelectable(true)
                setLineSpacing(4 * resources.displayMetrics.density, 1.12f)
            }
        },
        modifier = Modifier.fillMaxWidth(),
        update = { view ->
            view.setTextColor(color)
            view.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, scaledTextPx)
            if (view.tag != text) {
                renderer.setMarkdown(view, text)
                view.tag = text
            }
        },
    )
}

@Composable
fun Composer(vm: RelayModel) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val recorder = remember { NativeRecorder(context.applicationContext) }
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var modeMenu by remember { mutableStateOf(false) }
    var chosenMode by remember(vm.selected) { mutableStateOf<String?>(null) }
    val modes = vm.session?.modes() ?: emptyList()
    val mode =
        chosenMode?.takeIf { it in modes }
            ?: modes.firstOrNull { it != "queue" }
            ?: if (vm.session?.busy == true) "steer" else "send"
    val canAttach = vm.session?.can("attachFiles") == true
    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    val camera =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
            if (ok) cameraUri?.let { vm.addUri(it) }
            cameraUri = null
        }
    val pick =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { values
            ->
            values.forEach { vm.addUri(it) }
        }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted)
                runCatching { recorder.start() }
                    .onFailure { vm.error = it.message ?: "Microphone unavailable" }
            else {
                vm.error =
                    "Microphone permission is needed for dictation. You can enable it in Android app settings."
            }
        }
    fun finish() {
        recorder.finish()?.let(vm::transcribe)
    }
    DisposableEffect(lifecycle, vm.selected) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) finish()
        }
        lifecycle.lifecycle.addObserver(observer)
        onDispose {
            lifecycle.lifecycle.removeObserver(observer)
            recorder.cancel()
        }
    }
    LaunchedEffect(recorder.recording) {
        while (recorder.recording) {
            delay(100)
            recorder.tick()
            if (recorder.seconds >= 180) finish()
        }
    }
    Surface(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        shape = RoundedCornerShape(26.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) {
            if (vm.attachments.isNotEmpty())
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(vm.attachments, key = { it.str("id") }) { file ->
                        InputChip(
                            selected = false,
                            onClick = {},
                            label = {
                                Text(
                                    file.str("name"),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.widthIn(max = 140.dp),
                                )
                            },
                            leadingIcon = {
                                if (file.str("mime").startsWith("image/"))
                                    AsyncImage(
                                        model =
                                            vm.api.base +
                                                "/api/sessions/${vm.selected}/attachments/${file.str("id")}",
                                        contentDescription = "Preview of ${file.str("name")}",
                                        modifier =
                                            Modifier.size(32.dp).clip(RoundedCornerShape(6.dp)),
                                    )
                                else
                                    Icon(Icons.Outlined.InsertDriveFile, null, Modifier.size(18.dp))
                            },
                            trailingIcon = {
                                IconButton(onClick = { vm.removeAttachment(file.str("id")) }) {
                                    Icon(Icons.Outlined.Close, "Remove ${file.str("name")}")
                                }
                            },
                        )
                    }
                }
            if (vm.uploading > 0) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
                Text(
                    "Uploading ${vm.uploading} attachment${if (vm.uploading > 1) "s" else ""}…",
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            if (recorder.recording || vm.transcribing) {
                Row(
                    Modifier.heightIn(min = 64.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (vm.transcribing)
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else
                        Row(
                            Modifier.width(74.dp).height(32.dp),
                            horizontalArrangement = Arrangement.spacedBy(3.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            repeat(10) { index ->
                                Box(
                                    Modifier.width(4.dp)
                                        .height((4 + recorder.level * (14 + (index % 4) * 5)).dp)
                                        .clip(RoundedCornerShape(2.dp))
                                        .background(MaterialTheme.colorScheme.primary)
                                )
                            }
                        }
                    Text(
                        if (vm.transcribing) "Transcribing and cleaning…"
                        else
                            "Listening · ${recorder.seconds / 60}:${(recorder.seconds % 60).toString().padStart(2, '0')}",
                        Modifier.weight(1f).padding(horizontal = 10.dp),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    ActionIcon(Icons.Outlined.Close, "Cancel dictation") {
                        recorder.cancel()
                        vm.cancelVoice()
                    }
                }
                if (recorder.recording)
                    FilledTonalButton(onClick = { finish() }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Outlined.Check, null)
                        Text("Finish dictation", Modifier.padding(start = 8.dp))
                    }
            }
            NativeComposer(
                vm.draft,
                MaterialTheme.colorScheme.onSurface,
                MaterialTheme.colorScheme.onSurfaceVariant,
                vm::edit,
                { uri, lease -> vm.addUri(uri, lease) },
                Modifier.fillMaxWidth().heightIn(min = 48.dp, max = 164.dp),
            )
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box {
                    ActionIcon(
                        Icons.Outlined.Add,
                        "Add attachment",
                        canAttach && vm.attachments.size + vm.uploading < 10,
                    ) {
                        menu = true
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(
                            text = { Text("Photos") },
                            leadingIcon = { Icon(Icons.Outlined.Image, null) },
                            onClick = {
                                menu = false
                                pick.launch(arrayOf("image/*"))
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Camera") },
                            leadingIcon = { Icon(Icons.Outlined.PhotoCamera, null) },
                            onClick = {
                                menu = false
                                runCatching {
                                        val file =
                                            java.io
                                                .File(
                                                    context.cacheDir,
                                                    "shared/camera-${System.currentTimeMillis()}.jpg",
                                                )
                                                .apply { parentFile!!.mkdirs() }
                                        cameraUri =
                                            androidx.core.content.FileProvider.getUriForFile(
                                                context,
                                                "${context.packageName}.files",
                                                file,
                                            )
                                        camera.launch(cameraUri!!)
                                    }
                                    .onFailure {
                                        vm.error = "No camera app is available. Use Photos instead."
                                    }
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Files") },
                            leadingIcon = { Icon(Icons.Outlined.InsertDriveFile, null) },
                            onClick = {
                                menu = false
                                pick.launch(arrayOf("*/*"))
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Paste image") },
                            leadingIcon = { Icon(Icons.Outlined.ContentPaste, null) },
                            onClick = {
                                menu = false
                                val clip =
                                    (context.getSystemService(Context.CLIPBOARD_SERVICE)
                                            as ClipboardManager)
                                        .primaryClip
                                val uris =
                                    clip?.let {
                                        (0 until it.itemCount).mapNotNull { index ->
                                            it.getItemAt(index).uri
                                        }
                                    } ?: emptyList()
                                if (uris.isEmpty())
                                    vm.error = "Copy an image first, or choose Photos."
                                else uris.forEach { vm.addUri(it, clip) }
                            },
                        )
                    }
                }
                Box(Modifier.weight(1f)) {
                    TextButton(onClick = { modeMenu = true }, enabled = modes.isNotEmpty()) {
                        Text(
                            when (mode) {
                                "steer" -> "Steer"
                                "queue" -> "Queue"
                                else -> "Send"
                            }
                        )
                        Icon(Icons.Outlined.ExpandMore, null, Modifier.size(18.dp))
                    }
                    DropdownMenu(expanded = modeMenu, onDismissRequest = { modeMenu = false }) {
                        modes.forEach { value ->
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        when (value) {
                                            "steer" -> "Steer active turn"
                                            "queue" -> "Queue for later"
                                            else -> "Send message"
                                        }
                                    )
                                },
                                onClick = {
                                    chosenMode = value
                                    modeMenu = false
                                },
                            )
                        }
                    }
                }
                if (vm.voiceEnabled)
                    ActionIcon(
                        Icons.Outlined.Mic,
                        "Dictate message",
                        !recorder.recording && !vm.transcribing,
                    ) {
                        if (
                            ContextCompat.checkSelfPermission(
                                context,
                                Manifest.permission.RECORD_AUDIO,
                            ) == PackageManager.PERMISSION_GRANTED
                        )
                            runCatching { recorder.start() }
                                .onFailure { vm.error = it.message ?: "Microphone unavailable" }
                        else permission.launch(Manifest.permission.RECORD_AUDIO)
                    }
                FilledIconButton(
                    onClick = { vm.send(mode) },
                    enabled =
                        mode in modes &&
                            !vm.sending &&
                            !vm.transcribing &&
                            !recorder.recording &&
                            vm.uploading == 0 &&
                            (vm.draft.isNotBlank() || vm.attachments.isNotEmpty()) &&
                            vm.outgoing?.str("state") != "uncertain",
                    modifier = Modifier.size(48.dp),
                ) {
                    if (vm.sending)
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else
                        Icon(
                            Icons.Outlined.ArrowUpward,
                            "${mode.replaceFirstChar { it.uppercase() }} instruction",
                        )
                }
            }
            if (vm.voiceOriginal.isNotBlank()) {
                var showOriginal by remember(vm.voiceOriginal) { mutableStateOf(false) }
                Text(
                    vm.notice,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = { showOriginal = !showOriginal }) {
                    Text(if (showOriginal) "Hide original" else "Original transcription")
                }
                if (showOriginal)
                    Text(
                        vm.voiceOriginal,
                        style = MaterialTheme.typography.bodySmall,
                        modifier =
                            Modifier.heightIn(max = 120.dp).verticalScroll(rememberScrollState()),
                    )
            }
            if (vm.canRetryVoice)
                TextButton(onClick = vm::retryVoice) { Text("Retry saved recording") }
            if (mode !in modes)
                Text(
                    if ((vm.session?.pending ?: 0) > 0)
                        "Answer the question above, or choose Queue for a later turn."
                    else
                        vm.session?.data?.str("diagnostic")?.ifBlank {
                            "This session is not ready for messages."
                        } ?: "",
                    style = MaterialTheme.typography.labelSmall,
                )
        }
    }
}
