package pro.skinnyc.relay

val slashShortcuts = listOf("help", "model", "permissions", "plan", "compact", "tasks", "agents", "stop")
fun isSlashCommand(text: String): Boolean = Regex("^/[a-zA-Z][\\w:-]*(?: |$)").containsMatchIn(text.trim())
fun commandScreen(action: String): String = when (action) {
    "details", "subagents", "questions" -> action
    "tasks" -> "tasks"
    else -> ""
}

fun goalStatus(status: String): String = when (status) {
    "active" -> "Running"
    "paused" -> "Paused"
    "blocked" -> "Blocked"
    "usageLimited" -> "Usage limit reached"
    "budgetLimited" -> "Token budget reached"
    "complete" -> "Completed"
    "cleared" -> "Cleared"
    "failed" -> "Failed"
    else -> status
}
