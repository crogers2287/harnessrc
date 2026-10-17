package pro.skinnyc.relay

val slashShortcuts = listOf("help", "model", "permissions", "plan", "compact", "tasks", "agents", "stop")
fun isSlashCommand(text: String): Boolean = Regex("^/[a-zA-Z][\\w:-]*(?: |$)").containsMatchIn(text.trim())
fun commandScreen(action: String): String = when (action) {
    "details", "subagents", "questions" -> action
    "tasks" -> "tasks"
    else -> ""
}
