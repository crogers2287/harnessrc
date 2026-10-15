package pro.skinnyc.relay

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object RelayNotifications {
    const val CONNECTION = "relay-listening"
    const val QUESTIONS = "relay-questions"
    const val COMPLETIONS = "relay-completions"
    const val FAILURES = "relay-failures"
    const val OPEN = "pro.skinnyc.relay.OPEN_NOTIFICATION"
    @Volatile var visibleSession: String? = null
    fun prefs(context: Context) = context.getSharedPreferences("relay", 0)
    fun allowed(context: Context) = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    fun enabled(context: Context) = prefs(context).getBoolean("notifications", false)
    fun channels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(listOf(
            NotificationChannel(CONNECTION, "Background connection", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) },
            NotificationChannel(QUESTIONS, "Questions and approvals", NotificationManager.IMPORTANCE_HIGH),
            NotificationChannel(COMPLETIONS, "Completed turns", NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(FAILURES, "Failed turns", NotificationManager.IMPORTANCE_DEFAULT),
        ))
    }
    fun sync(context: Context) {
        val intent = Intent(context, RelayNotificationService::class.java)
        if (enabled(context) && allowed(context)) ContextCompat.startForegroundService(context, intent)
        else context.stopService(intent)
    }
    fun toggle(context: Context, enabled: Boolean) {
        val prefs = prefs(context)
        if (enabled && !prefs.getBoolean("notifications", false)) {
            prefs.edit().remove("notificationCursor").remove("notificationSeen")
                .putLong("notificationSince", System.currentTimeMillis()).apply()
        }
        prefs.edit().putBoolean("notifications", enabled).apply()
        sync(context)
        if (!enabled) context.getSystemService(NotificationManager::class.java).cancelAll()
    }
    fun openIntent(context: Context, session: String, question: Boolean): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).setAction(OPEN)
            .setData(android.net.Uri.parse("relay://notification/${android.net.Uri.encode(session)}/${if (question) "questions" else "chat"}"))
            .putExtra("session", session).putExtra("question", question)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    fun show(context: Context, item: JSONObject) {
        if (!allowed(context)) return
        val kind = item.str("kind")
        val session = item.str("sessionId")
        val prefs = prefs(context)
        if ((visibleSession == session && kind != "question") || !prefs.getBoolean("notify:$kind", true)) return
        val channel = when (kind) { "question" -> QUESTIONS; "failure" -> FAILURES; else -> COMPLETIONS }
        val note = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification).setContentTitle(item.str("title"))
            .setContentText(if (prefs.getBoolean("notificationPreview", true)) item.str("body") else "Open Relay to view the session")
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).setOnlyAlertOnce(true)
            .setCategory(if (kind == "question") NotificationCompat.CATEGORY_MESSAGE else NotificationCompat.CATEGORY_STATUS)
            .setContentIntent(openIntent(context, session, kind == "question")).build()
        context.getSystemService(NotificationManager::class.java).notify("relay:$session:$kind", 1, note)
    }
}

/** Opt-in private push over the authenticated tailnet, independent of the Activity lifecycle. */
class RelayNotificationService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private var worker: Job? = null
    private var socket: WebSocket? = null
    private var api: RelayApi? = null
    private var base = ""
    private val prefs by lazy { RelayNotifications.prefs(this) }
    private val manager by lazy { getSystemService(NotificationManager::class.java) }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() { super.onCreate(); RelayNotifications.channels(this) }
    private fun status(text: String) = NotificationCompat.Builder(this, RelayNotifications.CONNECTION)
        .setSmallIcon(R.drawable.ic_notification).setContentTitle("Relay notifications")
        .setContentText(text).setOngoing(true).setOnlyAlertOnce(true)
        .setContentIntent(RelayNotifications.openIntent(this, "", false))
        .addAction(0, "Pause", PendingIntent.getService(this, 1,
            Intent(this, RelayNotificationService::class.java).setAction("pause"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        .build()
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "pause") prefs.edit().putBoolean("notifications", false).apply()
        if (!RelayNotifications.enabled(this) || !RelayNotifications.allowed(this)) { stopSelf(); return START_NOT_STICKY }
        val endpoint = prefs.getString("endpoint", RelayApi.DEFAULT_ENDPOINT)!!
        if (worker?.isActive == true && base == endpoint) return START_STICKY
        startForeground(4001, status("Connecting over Tailscale…"))
        worker?.cancel(); socket?.cancel(); api?.client?.dispatcher?.cancelAll()
        base = endpoint
        val connection = RelayApi(endpoint)
        api = connection
        worker = scope.launch {
            var retryMs = 1000L
            while (isActive) {
                try {
                    replay(connection)
                    val closed = CompletableDeferred<Unit>()
                    val client = connection.client.newBuilder().pingInterval(30, TimeUnit.SECONDS).build()
                    socket = client.newWebSocket(connection.request("/ws?notifications=1").build(), object : WebSocketListener() {
                        override fun onOpen(webSocket: WebSocket, response: Response) { wake.trySend(Unit) }
                        override fun onMessage(webSocket: WebSocket, text: String) { wake.trySend(Unit) }
                        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { closed.complete(Unit); wake.trySend(Unit) }
                        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { closed.complete(Unit); wake.trySend(Unit) }
                    })
                    manager.notify(4001, status("Listening for questions and completed turns"))
                    retryMs = 1000
                    while (isActive && !closed.isCompleted) {
                        withTimeoutOrNull(30000) { wake.receive() }
                        replay(connection)
                    }
                } catch (e: CancellationException) { throw e }
                catch (_: Exception) { /* Durable cursor catches up after network/auth returns. */ }
                finally { socket?.cancel(); socket = null }
                manager.notify(4001, status("Reconnecting · check Tailscale"))
                delay(retryMs); retryMs = (retryMs * 2).coerceAtMost(60000)
            }
        }
        return START_STICKY
    }
    private suspend fun replay(connection: RelayApi) {
        do {
            val cursor = if (prefs.contains("notificationCursor")) prefs.getLong("notificationCursor", 0) else null
            val since = prefs.getLong("notificationSince", System.currentTimeMillis())
            val result = connection.api("/api/notifications?since=$since" + (cursor?.let { "&after=$it" } ?: ""))
            if (!RelayNotifications.enabled(this)) return
            result.optJSONArray("pendingQuestions")?.let { pending ->
                val sessions = (0 until pending.length()).map { pending.getString(it) }.toSet()
                manager.activeNotifications.filter { it.tag?.startsWith("relay:") == true && it.tag.endsWith(":question") }.forEach {
                    if (it.tag.removePrefix("relay:").removeSuffix(":question") !in sessions) manager.cancel(it.tag, it.id)
                }
            }
            val seen = runCatching { JSONArray(prefs.getString("notificationSeen", "[]")) }.getOrDefault(JSONArray())
                .let { list -> (0 until list.length()).map { list.getString(it) }.toMutableSet() }
            // Collapse a reconnect burst to the newest alert in each session/category.
            val items = result.rows("items").filter { !seen.contains(it.str("id")) }
            items.associateBy { it.str("sessionId") + ":" + it.str("kind") }.values.forEach { RelayNotifications.show(this, it) }
            items.forEach { seen.add(it.str("id")) }
            prefs.edit().putLong("notificationCursor", result.getLong("cursor"))
                .putString("notificationSeen", JSONArray(seen.toList().takeLast(500)).toString()).commit()
        } while (result.optBoolean("more"))
    }
    override fun onDestroy() { worker?.cancel(); socket?.cancel(); api?.client?.dispatcher?.cancelAll(); scope.cancel(); super.onDestroy() }
}

class NotificationBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED))
            runCatching { RelayNotifications.sync(context) }
    }
}
