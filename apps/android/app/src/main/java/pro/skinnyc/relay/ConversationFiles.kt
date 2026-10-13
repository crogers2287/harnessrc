package pro.skinnyc.relay

import java.net.URLDecoder
import org.json.JSONObject

private val fileLinks = Regex("!?\\[([^]]*)]\\(<?(/[^\\s<>]+?)>?(?:\\s+\"[^\"]*\")?\\)")
private val downloadable = Regex("\\.(png|jpe?g|webp|gif|avif|mp4|m4v|webm|mov|mp3|m4a|wav|ogg|flac|aac|json|csv|tsv|txt|md|pdf|zip|tar|gz|yaml|yml|html|svg|docx|xlsx|pptx|py|js|ts)$", RegexOption.IGNORE_CASE)
fun mediaType(path: String): String = when {
    Regex("\\.(png|jpe?g|webp|gif|avif)$", RegexOption.IGNORE_CASE).containsMatchIn(path) -> "image"
    Regex("\\.(mp4|m4v|webm|mov)$", RegexOption.IGNORE_CASE).containsMatchIn(path) -> "video"
    Regex("\\.(mp3|m4a|wav|ogg|flac|aac)$", RegexOption.IGNORE_CASE).containsMatchIn(path) -> "audio"
    else -> "file"
}
fun conversationFiles(kind: String, body: JSONObject): List<JSONObject> {
    fun valid(path: String) = path.startsWith('/') && !path.startsWith("//") && !path.contains('\u0000')
    if (kind == "artifact.created") return body.rows("nativeFiles").filter { valid(it.str("path")) }.take(32)
    if (kind != "assistant.message") return emptyList()
    val text = body.str("text").replace(Regex("```[^\\n]*\\n[\\s\\S]*?```"), "")
    val links = fileLinks.findAll(text).toList()
    val result = mutableListOf<JSONObject>()
    fun add(link: MatchResult, imageOnly: Boolean) {
        val path = runCatching { URLDecoder.decode(link.groupValues[2].replace("+", "%2B"), "UTF-8") }.getOrDefault(link.groupValues[2])
        if (!valid(path) || !downloadable.containsMatchIn(path) || (imageOnly && mediaType(path) != "image")) return
        if (!imageOnly && result.any { it.str("path") == path }) return
        if (result.size < 32) result.add(json("path" to path, "description" to link.groupValues[1]))
    }
    links.filter { it.value.startsWith("!") }.forEach { add(it, true) }
    links.forEach { add(it, false) }
    return result
}
