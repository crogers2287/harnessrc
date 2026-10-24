package pro.skinnyc.relay

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentConversationNavigation(vm: RelayModel, selected: String, activity: Boolean, select: (String) -> Unit, tab: (Boolean) -> Unit, showBar: Boolean = true) {
    val parent = vm.selected
    var agents by remember(parent) { mutableStateOf<List<JSONObject>>(emptyList()) }
    var supported by remember(parent) { mutableStateOf(true) }
    var error by remember(parent) { mutableStateOf("") }
    var loading by remember(parent) { mutableStateOf(true) }
    var picker by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val choose: (String) -> Unit = { focus.clearFocus(); keyboard?.hide(); picker = false; select(it) }
    LaunchedEffect(parent, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                try {
                    val result = vm.api.api("/api/sessions/$parent/subagents")
                    agents = result.rows("subagents"); supported = result.optBoolean("supported"); error = ""
                } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: "Could not load agents" }
                loading = false
                delay(5000)
            }
        }
    }
    if (showBar) Column {
        TextButton(onClick = { search = ""; picker = true }, modifier = Modifier.fillMaxWidth()) {
            Icon(if (selected.isBlank()) Icons.Outlined.ChatBubbleOutline else Icons.Outlined.AccountTree, null)
            Spacer(Modifier.width(8.dp))
            Text(agents.find { it.str("id") == selected }?.str("name") ?: if (selected.isBlank()) "Main conversation" else "Sub-agent conversation", Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${agents.size} agents", style = MaterialTheme.typography.labelSmall)
            Icon(Icons.Outlined.ExpandMore, "Choose conversation")
        }
        TabRow(selectedTabIndex = if (activity) 1 else 0) {
            Tab(selected = !activity, onClick = { tab(false) }, text = { Text("Chat") })
            Tab(selected = activity, onClick = { tab(true) }, text = { Text("Activity") })
        }
        HorizontalDivider()
    }
    if (picker) ModalBottomSheet(onDismissRequest = { picker = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            Text("Conversations", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(search, { search = it }, label = { Text("Find an agent") }, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp), singleLine = true)
            LazyColumn(Modifier.weight(1f, fill = false), contentPadding = PaddingValues(bottom = 16.dp)) {
                item {
                    TextButton(onClick = { choose("") }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Outlined.ChatBubbleOutline, null)
                        Column(Modifier.weight(1f).padding(12.dp)) {
                            Text(vm.session?.title ?: "Main conversation", maxLines = 2)
                            Text("Main conversation", style = MaterialTheme.typography.bodySmall)
                        }
                        if (selected.isBlank()) Icon(Icons.Outlined.Check, "Selected")
                    }
                    HorizontalDivider()
                    Text("Sub-agents", Modifier.padding(vertical = 12.dp), style = MaterialTheme.typography.titleSmall)
                    if (loading) Text("Finding linked agents…")
                    if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                    if (!loading && agents.isEmpty()) Text(if (supported) "No linked sub-agents recorded yet." else "This harness does not expose linked agents yet.")
                    if (search.isNotBlank() && agents.none { (it.str("name") + it.str("model")).contains(search, true) }) Text("No agents match this search.")
                }
                items(agents.filter { (it.str("name") + it.str("model")).contains(search, true) }, key = { it.str("id") }) { agent ->
                    TextButton(onClick = { choose(agent.str("id")) }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Outlined.AccountTree, null)
                        Column(Modifier.weight(1f).padding(12.dp)) {
                            Text(agent.str("name"), fontWeight = FontWeight.Medium)
                            Text(agent.str("model", "Model not reported"), style = MaterialTheme.typography.bodySmall)
                            Text("${agentRecordedStatus(agent.str("status"))} · ${agent.str("updatedAt")}", style = MaterialTheme.typography.labelSmall)
                        }
                        if (selected == agent.str("id")) Icon(Icons.Outlined.Check, "Selected")
                    }
                }
            }
            Text("Sub-agent conversations are view only. Send instructions through the main conversation.", Modifier.padding(bottom = 20.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
private fun agentRecordedStatus(value: String) = when (value) {
    "working" -> "Working"; "blocked" -> "Waiting"; "idle" -> "Ready"; "done" -> "Finished"; "offline" -> "Offline"; "ended" -> "Ended"; else -> "Recorded"
}

@Composable
fun AgentConversation(vm: RelayModel, child: String, activity: Boolean, modifier: Modifier = Modifier) {
    val parent = vm.selected
    var events by remember(parent, child) { mutableStateOf<List<ChatEvent>>(emptyList()) }
    var loading by remember(parent, child) { mutableStateOf(true) }
    var error by remember(parent, child) { mutableStateOf("") }
    var olderLoading by remember { mutableStateOf(false) }
    var more by remember(parent, child) { mutableStateOf(true) }
    val list = rememberLazyListState()
    var positioned by rememberSaveable(parent, child, activity) { mutableStateOf(false) }
    var following by rememberSaveable(parent, child, activity) { mutableStateOf(true) }
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(parent, child, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                try {
                    val result = vm.api.api("/api/sessions/$parent/subagents/$child/events?limit=100")
                    events = mergeEvents(events, result.rows("events").map(::ChatEvent)); error = ""
                } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: "Could not load conversation" }
                loading = false
                delay(3000)
            }
        }
    }
    val groups = groupConversationActivity(conversationRows(events).filter { if (activity) isGroupedActivity(it) else !isGroupedActivity(it) })
    LaunchedEffect(loading, groups.size, groups.lastOrNull()?.lastOrNull()?.text) {
        if (!loading && groups.isNotEmpty() && (following || !positioned)) {
            list.scrollToItem(list.layoutInfo.totalItemsCount.coerceAtLeast(1) - 1); positioned = true
        }
    }
    LaunchedEffect(list.isScrollInProgress) { if (list.isScrollInProgress && positioned) following = false }
    Column(modifier) {
        Text("View only · The parent agent controls this work.", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (loading) item { CircularProgressIndicator() }
            if (error.isNotBlank()) item { Text(error, color = MaterialTheme.colorScheme.error) }
            if (more && (events.firstOrNull()?.sequence ?: 0) > 1) item {
                TextButton(enabled = !olderLoading, onClick = { scope.launch {
                    olderLoading = true; following = false
                    try {
                        val result = vm.api.api("/api/sessions/$parent/subagents/$child/events?before=${events.first().sequence}&limit=100")
                        more = result.rows("events").size == 100
                        events = mergeEvents(events, result.rows("events").map(::ChatEvent))
                    } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: "Could not load history" }
                    finally { olderLoading = false }
                } }) { Text(if (olderLoading) "Loading…" else "Load earlier messages") }
            }
            if (!loading && error.isBlank() && groups.isEmpty()) item { Text(if (activity) "No activity recorded yet." else "No conversation recorded yet.") }
            items(groups, key = { it.first().id }) { group ->
                val event = group.first()
                if (isGroupedActivity(event)) {
                    var expanded by remember(event.id) { mutableStateOf(false) }
                    Column {
                        TextButton(onClick = { expanded = !expanded }) { Text("Agent activity · ${group.size}") }
                        if (expanded) group.forEach { item -> SelectionContainerCompat { Text(item.body.toString(2).take(24000)) } }
                    }
                } else Column {
                    Text(if (event.kind == "user.message") "User" else "Agent", style = MaterialTheme.typography.labelMedium)
                    MarkdownText(displayText(event.text), vm.api.base)
                    MessageTime(event, if (event.kind == "user.message") "Sent" else "Received")
                }
            }
        }
        if (!following) TextButton(onClick = { following = true; scope.launch { list.scrollToItem(list.layoutInfo.totalItemsCount.coerceAtLeast(1) - 1) } }, modifier = Modifier.fillMaxWidth()) { Text("Latest messages") }
        HorizontalDivider()
        Text("Return to Main conversation to send a message.", Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
