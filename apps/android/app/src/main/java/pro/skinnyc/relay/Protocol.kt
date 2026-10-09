package pro.skinnyc.relay

import org.json.JSONArray
import org.json.JSONObject

fun JSONObject.str(key: String, default: String = "") =
    optString(key, default).takeUnless { it == "null" } ?: default

fun JSONObject.obj(key: String) = optJSONObject(key) ?: JSONObject()

fun JSONObject.rows(key: String) = (optJSONArray(key) ?: JSONArray()).objects()

fun JSONArray.objects() = (0 until length()).mapNotNull { optJSONObject(it) }

fun json(vararg values: Pair<String, Any?>) =
    JSONObject().apply { values.forEach { (k, v) -> put(k, v) } }

data class Session(val data: JSONObject) {
    val id = data.str("id")
    val title =
        data.str("relayName").ifBlank {
            data.str("sessionName").ifBlank { data.str("project", "Session") }
        }
    val harness = data.str("harness")
    val agent =
        when (harness) {
            "dsh" -> "DSH"
            "claude" -> "Claude Code"
            "codex" -> "Codex"
            "omp" -> "OMP"
            "pi" -> "Pi"
            else -> harness.replaceFirstChar { it.uppercase() }
        }
    val profile = data.str("agentPreset")
    val model = data.str("model", "Model not reported")
    val cwd = data.str("cwd")
    val status = data.str("status")
    val busy
        get() = status == "working" || status == "blocked"

    val pending = data.optInt("pendingCount")
    val queued = data.optInt("queuedCount")
    val subtitle
        get() = listOf(agent, profile, model).filter { it.isNotBlank() }.joinToString(" · ")

    fun can(capability: String) = data.obj("capabilities").optBoolean(capability)

    fun modes(): List<String> = buildList {
        if (pending == 0 && (if (busy) can("steerActiveTurn") else can("sendMessage")))
            add(if (busy) "steer" else "send")
        if (can("queueTask")) add("queue")
    }
}

/** Working agents first; real activity breaks ties, independent of API ordering. */
fun sortedSessions(sessions: List<Session>): List<Session> =
    sessions.sortedWith(
        compareBy<Session> {
                when {
                    it.status == "working" -> 0
                    it.pending > 0 || it.status == "blocked" -> 1
                    it.status == "ended" ||
                        it.data.optBoolean("archived") ||
                        it.data.str("presence") == "saved" -> 3
                    else -> 2
                }
            }
            .thenByDescending {
                runCatching { java.time.Instant.parse(it.data.str("lastActivity")).toEpochMilli() }
                    .getOrDefault(0L)
            }
            .thenByDescending { it.data.optBoolean("pinned") }
            .thenBy { it.id }
    )

data class ChatEvent(val data: JSONObject) {
    val id = data.str("id")
    val sequence = data.optLong("sequence")
    val kind = data.str("kind")
    val body = data.obj("data")
    val text = body.str("text")
    val item = body.str("itemId")
}

/** Native event IDs, never text similarity, determine transcript identity. */
fun mergeEvents(existing: List<ChatEvent>, incoming: List<ChatEvent>): List<ChatEvent> {
    val all = (existing + incoming).associateBy { it.id }.values.sortedBy { it.sequence }
    val replaced =
        all.flatMap { event ->
                val values = event.body.optJSONArray("replacesEventSourceIds") ?: JSONArray()
                (0 until values.length()).map { values.optString(it) }
            }
            .toSet()
    return all.filterNot { it.data.str("sourceId") in replaced }
}

fun conversationRows(events: List<ChatEvent>): List<ChatEvent> {
    val complete =
        events
            .filter { it.kind == "assistant.message" && it.item.isNotBlank() }
            .map { it.item }
            .toSet()
    val deltas = linkedMapOf<String, ChatEvent>()
    val output = mutableListOf<ChatEvent>()
    events.forEach { event ->
        if (event.kind == "assistant.delta") {
            if (event.item !in complete) {
                val key = event.item.ifBlank { event.data.str("turnId", event.id) }
                val old = deltas[key]
                val combined =
                    JSONObject(event.data.toString())
                        .put(
                            "data",
                            JSONObject(event.body.toString())
                                .put("text", (old?.text ?: "") + event.text),
                        )
                deltas[key] =
                    ChatEvent(
                        combined
                            .put("id", old?.id ?: event.id)
                            .put("sequence", old?.sequence ?: event.sequence)
                    )
            }
        } else if (
            event.kind in
                setOf(
                    "user.message",
                    "assistant.message",
                    "reasoning.summary",
                    "tool.invocation",
                    "tool.output",
                    "tool.completion",
                    "file.change",
                    "artifact.created",
                    "diff",
                    "plan",
                    "turn.failed",
                )
        )
            output.add(event)
    }
    return (output + deltas.values).sortedBy { it.sequence }
}

fun displayText(value: String): String {
    var text = value.replace(Regex("\\n?\\[Relay request [a-f0-9-]+]"), "")
    val reply =
        Regex(
                "^\\s*<send_user_message_question_reply>\\s*([\\s\\S]*?)\\s*</send_user_message_question_reply>\\s*$"
            )
            .find(text)
    if (reply != null)
        runCatching {
            return JSONArray(reply.groupValues[1]).objects().joinToString("\n\n") {
                "**${it.str("question")}**\n${it.str("answer")}"
            }
        }
    val command = Regex("<command-name>(.*?)</command-name>").find(text)
    if (command != null)
        return command.groupValues[1] +
            " " +
            (Regex("<command-args>([\\s\\S]*?)</command-args>").find(text)?.groupValues?.get(1)
                ?: "")
    text =
        text.replace(
            Regex("</?(?:local-command-stdout|local-command-stderr|pasted_content)(?: [^>]*)?>"),
            "",
        )
    return text.trim()
}

data class TaskNotice(
    val title: String,
    val summary: String,
    val details: List<Pair<String, String>>,
)

/** Only complete, known transport envelopes are interpreted; code examples stay literal. */
fun taskNotice(text: String): TaskNotice? {
    val match =
        Regex(
                """^\s*<task-notification>([\s\S]*?)</task-notification>\s*(?:<system-reminder>([\s\S]*?)</system-reminder>\s*)?$"""
            )
            .matchEntire(text) ?: return null
    val fields = linkedMapOf<String, String>()
    var valid = true
    val rest =
        Regex(
                """<(task-id|tool-use-id|output-file|status|summary|task-type|result|usage|diagnostics)>([\s\S]*?)</\1>"""
            )
            .replace(match.groupValues[1]) {
                val key = it.groupValues[1]
                if (fields.containsKey(key)) valid = false
                fields[key] = it.groupValues[2].trim()
                ""
            }
    if (!valid || rest.isNotBlank() || fields["summary"].isNullOrBlank()) return null
    val title =
        when (fields["status"]) {
            "completed" -> "Background task completed"
            "failed" -> "Background task failed"
            "killed" -> "Background task stopped"
            else -> "Background task update"
        }
    val labels =
        mapOf(
            "task-id" to "Task",
            "tool-use-id" to "Tool call",
            "output-file" to "Output file",
            "task-type" to "Task type",
        )
    val details =
        fields
            .filterKeys { it != "summary" }
            .map { (key, value) ->
                (labels[key] ?: key.replaceFirstChar { it.uppercase() }) to
                    if (key == "usage" || key == "diagnostics")
                        value
                            .replace(Regex("</[^>]+>"), "; ")
                            .replace(Regex("<([^>]+)>"), "$1: ")
                            .trim()
                    else value
            } +
            match.groupValues[2]
                .takeIf { it.isNotBlank() }
                ?.let { listOf("Context" to it.trim()) }
                .orEmpty()
    return TaskNotice(title, fields.getValue("summary"), details)
}

fun messageTimestamp(
    value: String,
    zone: java.time.ZoneId = java.time.ZoneId.systemDefault(),
    locale: java.util.Locale = java.util.Locale.getDefault(),
): String? =
    runCatching {
            java.time.Instant.parse(value)
                .atZone(zone)
                .format(
                    java.time.format.DateTimeFormatter.ofLocalizedDateTime(
                            java.time.format.FormatStyle.MEDIUM,
                            java.time.format.FormatStyle.SHORT,
                        )
                        .withLocale(locale)
                )
        }
        .getOrNull()
