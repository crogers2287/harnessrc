package pro.skinnyc.relay

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.io.File
import java.net.URLEncoder
import java.util.UUID
import kotlinx.coroutines.*
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject

class RelayModel(application: Application) : AndroidViewModel(application) {
    private val prefs = application.getSharedPreferences("relay", 0)
    val api = RelayApi(prefs.getString("endpoint", RelayApi.DEFAULT_ENDPOINT)!!)
    var sessions by mutableStateOf(listOf<Session>())
        private set

    var selected by mutableStateOf(prefs.getString("session", "")!!)
        private set

    val session
        get() = sessions.find { it.id == selected }

    var events by mutableStateOf(listOf<ChatEvent>())
        private set

    var interactions by mutableStateOf(listOf<JSONObject>())
        private set

    var tasks by mutableStateOf(listOf<JSONObject>())
        private set

    var draft by mutableStateOf("")
        private set

    var attachments by mutableStateOf(listOf<JSONObject>())
        private set

    var outgoing by mutableStateOf<JSONObject?>(null)
        private set

    var connected by mutableStateOf(false)
        private set

    var loading by mutableStateOf(true)
        private set

    var uploading by mutableStateOf(0)
        private set

    var sending by mutableStateOf(false)
        private set

    var working by mutableStateOf(false)
        private set

    var error by mutableStateOf("")
    var notice by mutableStateOf("")
    var hasOlder by mutableStateOf(false)
        private set

    var voiceEnabled by mutableStateOf(false)
        private set

    var transcribing by mutableStateOf(false)
        private set

    var voiceOriginal by mutableStateOf("")
        private set

    private val uploadSlots = kotlinx.coroutines.sync.Semaphore(2)
    private var socket: WebSocket? = null
    private var foreground = false
    private var retry: Job? = null
    private var refresh: Job? = null
    private var voiceJob: Job? = null
    private var retryAudio: File? = null
    private var retrySession = ""
    private val cache
        get() = File(getApplication<Application>().filesDir, "conversations").apply { mkdirs() }

    private fun cachedConversation(id: String): File {
        val key =
            java.security.MessageDigest.getInstance("SHA-256")
                .digest(id.toByteArray())
                .joinToString("") { "%02x".format(it) }
        return File(cache, "$key.json")
    }

    fun start() {
        if (foreground) return
        foreground = true
        viewModelScope.launch {
            refreshSessions()
            connect()
        }
    }

    fun stop() {
        foreground = false
        retry?.cancel()
        socket?.close(1000, "Background")
        socket = null
        connected = false
    }

    private fun connect() {
        if (!foreground || socket != null) return
        socket =
            api.websocket(
                object : WebSocketListener() {
                    override fun onOpen(ws: WebSocket, response: Response) {
                        viewModelScope.launch {
                            connected = true
                            refreshSessions()
                            loadCurrent()
                        }
                    }

                    override fun onMessage(ws: WebSocket, text: String) {
                        viewModelScope.launch {
                            runCatching {
                                val value = JSONObject(text)
                                if (value.str("type") == "invalidate") {
                                    sessions = value.rows("sessions").map(::Session)
                                    refresh?.cancel()
                                    refresh =
                                        viewModelScope.launch {
                                            delay(250)
                                            detail(selected)
                                        }
                                }
                                if (value.str("type") == "event") {
                                    val event = ChatEvent(value.obj("event"))
                                    if (event.data.str("sessionId") == selected)
                                        events = mergeEvents(events, listOf(event))
                                }
                            }
                        }
                    }

                    override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                        reconnect(ws)
                    }

                    override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                        reconnect(ws)
                    }
                }
            )
    }

    private fun reconnect(ws: WebSocket) {
        viewModelScope.launch {
            if (socket !== ws) return@launch
            socket = null
            connected = false
            retry?.cancel()
            if (foreground)
                retry =
                    viewModelScope.launch {
                        delay(3000)
                        connect()
                    }
        }
    }

    suspend fun refreshSessions() {
        try {
            sessions = api.api("/api/sessions").rows("sessions").map(::Session)
            voiceEnabled = api.api("/api/voice").optBoolean("enabled")
            if (sessions.none { it.id == selected })
                selected =
                    sessions
                        .firstOrNull { it.data.str("presence") != "saved" && it.status != "ended" }
                        ?.id ?: sessions.firstOrNull()?.id ?: ""
            if (draft.isEmpty() && events.isEmpty()) restoreDraft()
            loadCurrent()
            error = ""
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = friendly(e)
        } finally {
            loading = false
        }
    }

    fun choose(id: String) {
        if (id == selected) return
        saveDraft()
        cancelVoice()
        selected = id
        prefs.edit().putString("session", id).apply()
        draft = ""
        attachments = emptyList()
        outgoing = null
        events = emptyList()
        interactions = emptyList()
        tasks = emptyList()
        notice = ""
        error = ""
        restoreDraft()
        viewModelScope.launch { loadCurrent() }
    }

    private fun restoreDraft() {
        if (selected.isBlank()) return
        runCatching {
            val saved = JSONObject(prefs.getString("draft:$selected", "{}")!!)
            draft = saved.str("text")
            attachments = saved.rows("attachments")
            outgoing = saved.optJSONObject("outgoing")
            if (outgoing != null && outgoing!!.str("state") == "sending")
                outgoing = JSONObject(outgoing.toString()).put("state", "uncertain")
            val file = cachedConversation(selected)
            if (file.exists()) events = JSONArray(file.readText()).objects().map(::ChatEvent)
        }
    }

    private fun saveDraft(durable: Boolean = false): Boolean {
        if (selected.isBlank()) return false
        val editor =
            prefs
                .edit()
                .putString(
                    "draft:$selected",
                    json(
                            "text" to draft,
                            "attachments" to JSONArray(attachments),
                            "outgoing" to outgoing,
                        )
                        .toString(),
                )
        if (durable) return editor.commit()
        editor.apply()
        return true
    }

    fun edit(text: String) {
        draft = text
        saveDraft()
    }

    fun removeAttachment(id: String) {
        attachments = attachments.filterNot { it.str("id") == id }
        saveDraft()
    }

    suspend fun loadCurrent(older: Boolean = false) {
        val id = selected
        if (id.isBlank()) return
        try {
            val before =
                if (older) events.minOfOrNull { it.sequence } ?: Long.MAX_VALUE
                else 9007199254740991L
            val rows =
                api.api("/api/sessions/$id/events?before=$before&limit=100&conversation=1")
                    .rows("events")
                    .map(::ChatEvent)
            if (selected != id) return
            events = mergeEvents(events, rows)
            if (older || events.size <= 100) hasOlder = rows.size == 100
            withContext(Dispatchers.IO) {
                cachedConversation(id)
                    .writeText(JSONArray(events.takeLast(200).map { it.data }).toString())
            }
            detail(id)
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            if (id == selected) error = friendly(e)
        }
    }

    private suspend fun detail(id: String) {
        if (id.isBlank()) return
        try {
            val data = api.api("/api/sessions/$id")
            if (selected != id) return
            interactions = data.rows("interactions")
            tasks = data.rows("tasks")
            data.optJSONObject("session")?.let { updated ->
                sessions = sessions.map { if (it.id == id) Session(updated) else it }
            }
            outgoing?.let { pending ->
                val key = pending.str("idempotencyKey")
                val receipt = api.api("/api/sessions/$id/message-receipts/$key")
                if (
                    selected == id &&
                        outgoing?.str("idempotencyKey") == key &&
                        (receipt.optBoolean("nativeSeen") || receipt.optBoolean("confirmed"))
                ) {
                    if (draft == pending.str("prompt")) draft = ""
                    val sent = pending.optJSONArray("attachments") ?: JSONArray()
                    attachments =
                        attachments.filterNot { file ->
                            (0 until sent.length()).any { sent.optString(it) == file.str("id") }
                        }
                    outgoing = null
                    error = ""
                    notice = "Delivery confirmed"
                    saveDraft()
                }
            }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            if (selected == id) error = friendly(e)
        }
    }

    fun addUri(uri: Uri, permissionLease: Any? = null) {
        val id = selected
        if (id.isBlank() || session?.can("attachFiles") != true) {
            error = "Attachments are unavailable for this session."
            return
        }
        if (attachments.size + uploading >= 10) {
            error = "Up to 10 attachments per message."
            return
        }
        uploading++
        viewModelScope.launch {
            var acquired = false
            try {
                uploadSlots.acquire()
                acquired = true
                val (bytes, name, mime) =
                    withContext(Dispatchers.IO) {
                        val resolver = getApplication<Application>().contentResolver
                        require(uri.scheme == "content") {
                            "Only shared Android content can be attached."
                        }
                        val name =
                            resolver
                                .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                                ?.use { if (it.moveToFirst()) it.getString(0) else null }
                                ?: "Screenshot.png"
                        val mime = resolver.getType(uri) ?: "application/octet-stream"
                        val bytes =
                            resolver.openInputStream(uri)?.use { stream ->
                                val output = java.io.ByteArrayOutputStream()
                                val buffer = ByteArray(16384)
                                while (true) {
                                    val n = stream.read(buffer)
                                    if (n < 0) break
                                    require(output.size() + n <= 20 * 1024 * 1024) {
                                        "Files must be 20 MB or smaller."
                                    }
                                    output.write(buffer, 0, n)
                                }
                                output.toByteArray()
                            }
                                ?: error(
                                    "This image is no longer available. Copy it again or use Photos."
                                )
                        // Keep the IME permission lease reachable until its content has been
                        // copied.
                        java.lang.ref.Reference.reachabilityFence(permissionLease)
                        Triple(bytes, name, mime)
                    }
                val result =
                    api.binary(
                            "/api/sessions/$id/attachments?name=${encode(name)}&mime=${encode(mime)}",
                            bytes,
                        )
                        .obj("attachment")
                if (selected == id) {
                    attachments = attachments + result
                    saveDraft()
                } else { // Preserve the completed upload in the session it was started from.
                    val saved = JSONObject(prefs.getString("draft:$id", "{}")!!)
                    saved.put("attachments", JSONArray(saved.rows("attachments") + result))
                    prefs.edit().putString("draft:$id", saved.toString()).apply()
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                error = friendly(e)
            } finally {
                if (acquired) uploadSlots.release()
                uploading--
            }
        }
    }

    fun send(mode: String) {
        if (sending || uploading > 0 || transcribing || outgoing?.str("state") == "uncertain")
            return
        val s = session ?: return
        if (mode !in s.modes()) {
            error = "This action is no longer available. Check the session state."
            return
        }
        val prompt =
            draft.trim().ifBlank {
                if (attachments.isNotEmpty()) "Please review the attached files." else return
            }
        val payload =
            json(
                "prompt" to prompt,
                "idempotencyKey" to UUID.randomUUID().toString(),
                "attachments" to JSONArray(attachments.map { it.str("id") }),
            )
        submit(s.id, payload, mode, draft)
    }

    private fun submit(id: String, payload: JSONObject, mode: String, original: String) {
        sending = true
        error = ""
        outgoing = JSONObject(payload.toString()).put("state", "sending").put("mode", mode)
        if (!saveDraft(durable = true)) {
            sending = false
            outgoing = null
            error =
                "Could not save delivery recovery. Nothing was sent. Free some device storage and try again."
            return
        }
        viewModelScope.launch {
            try {
                val result =
                    api.api(
                        "/api/sessions/$id/${if (mode == "queue") "tasks" else "messages"}",
                        "POST",
                        payload,
                    )
                if (selected == id) {
                    if (draft == original) draft = ""
                    val sent = payload.optJSONArray("attachments") ?: JSONArray()
                    attachments =
                        attachments.filterNot { file ->
                            (0 until sent.length()).any { sent.optString(it) == file.str("id") }
                        }
                    outgoing =
                        if (mode == "queue") null
                        else
                            JSONObject(payload.toString())
                                .put("state", "accepted")
                                .put("mode", mode)
                    notice =
                        when {
                            mode == "queue" -> "Queued for a later turn"
                            result.str("mode") == "steer" ->
                                "Steering accepted · applies at the next supported step"
                            else -> "Sent"
                        }
                    saveDraft()
                    loadCurrent()
                } else {
                    val saved = JSONObject(prefs.getString("draft:$id", "{}")!!)
                    if (saved.str("text") == original) saved.put("text", "")
                    val ids = payload.optJSONArray("attachments") ?: JSONArray()
                    saved.put(
                        "attachments",
                        JSONArray(
                            saved.rows("attachments").filterNot { file ->
                                (0 until ids.length()).any { ids.optString(it) == file.str("id") }
                            }
                        ),
                    )
                    saved.put(
                        "outgoing",
                        if (mode == "queue") JSONObject.NULL
                        else
                            JSONObject(payload.toString())
                                .put("state", "accepted")
                                .put("mode", mode),
                    )
                    prefs.edit().putString("draft:$id", saved.toString()).apply()
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (selected == id) {
                    if (e is ApiFailure && e.status in listOf(400, 401, 403, 413, 422, 429))
                        outgoing = null
                    else
                        outgoing =
                            JSONObject(payload.toString())
                                .put("state", "uncertain")
                                .put("mode", mode)
                    error =
                        if (outgoing != null)
                            "Delivery not confirmed. Check the conversation or retry this same request safely."
                        else friendly(e)
                    saveDraft()
                } else {
                    val saved = JSONObject(prefs.getString("draft:$id", "{}")!!)
                    saved.put(
                        "outgoing",
                        JSONObject(payload.toString()).put("state", "uncertain").put("mode", mode),
                    )
                    prefs.edit().putString("draft:$id", saved.toString()).apply()
                }
            } finally {
                sending = false
            }
        }
    }

    fun retrySend() {
        val pending = outgoing ?: return
        if (sending || pending.str("state") != "uncertain") return
        submit(
            selected,
            json(
                "prompt" to pending.str("prompt"),
                "idempotencyKey" to pending.str("idempotencyKey"),
                "attachments" to pending.optJSONArray("attachments"),
            ),
            pending.str("mode"),
            pending.str("prompt"),
        )
    }

    fun operation(
        path: String,
        body: JSONObject,
        method: String = "POST",
        done: (JSONObject) -> Unit = {},
    ) {
        if (working) return
        working = true
        error = ""
        viewModelScope.launch {
            try {
                val result = api.api(path, method, body)
                done(result)
                refreshSessions()
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                error = friendly(e)
                detail(selected)
            } finally {
                working = false
            }
        }
    }

    fun older() {
        viewModelScope.launch { loadCurrent(true) }
    }

    fun reload() {
        viewModelScope.launch { refreshSessions() }
    }

    fun endpoint(value: String) {
        val uri = Uri.parse(value.trim().trimEnd('/'))
        require(
            uri.scheme == "https" &&
                !uri.host.isNullOrBlank() &&
                uri.userInfo == null &&
                uri.query == null &&
                uri.fragment == null &&
                (uri.path.isNullOrBlank() || uri.path == "/")
        ) {
            "Use an HTTPS gateway origin without credentials or a path."
        }
        stop()
        api.base = value.trim().trimEnd('/')
        prefs.edit().putString("endpoint", api.base).apply()
        selected = ""
        events = emptyList()
        sessions = emptyList()
        start()
    }

    fun transcribe(file: File) {
        if (transcribing) return
        val id = selected
        if (id.isBlank()) return
        retryAudio?.takeIf { it != file }?.delete()
        retryAudio = file
        retrySession = id
        transcribing = true
        error = ""
        voiceOriginal = ""
        voiceJob =
            viewModelScope.launch {
                try {
                    val data =
                        api.binary(
                            "/api/sessions/$id/dictation?mime=audio%2Fmp4",
                            withContext(Dispatchers.IO) { file.readBytes() },
                        )
                    val text = data.str("text")
                    require(text.isNotBlank()) { "No speech detected. Record again." }
                    if (selected == id) {
                        edit(
                            listOf(draft.trimEnd(), text)
                                .filter { it.isNotBlank() }
                                .joinToString("\n")
                        )
                        voiceOriginal = data.str("original")
                        notice =
                            data.str("warning").ifBlank {
                                "Dictation added · review before sending"
                            }
                        retryAudio = null
                        file.delete()
                    }
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    error = "${friendly(e)} Your recording is available to retry."
                } finally {
                    transcribing = false
                }
            }
    }

    fun retryVoice() {
        retryAudio?.takeIf { retrySession == selected }?.let(::transcribe)
    }

    val canRetryVoice
        get() = retryAudio != null && !transcribing && retrySession == selected

    fun cancelVoice() {
        voiceJob?.cancel()
        transcribing = false
        retryAudio?.delete()
        retryAudio = null
    }

    override fun onCleared() {
        stop()
        cancelVoice()
    }

    private fun friendly(e: Exception) =
        if (e is ApiFailure && e.status == 401)
            "Connect Tailscale on this phone, then reconnect. The gateway must authorize this device."
        else e.message ?: "Connection failed. Check Tailscale and try again."
}

fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
