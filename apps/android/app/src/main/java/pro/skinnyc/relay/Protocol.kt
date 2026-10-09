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
