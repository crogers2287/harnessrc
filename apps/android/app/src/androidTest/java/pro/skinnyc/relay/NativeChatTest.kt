package pro.skinnyc.relay

import android.content.*
import android.graphics.Bitmap
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.core.content.FileProvider
import androidx.core.view.inputmethod.EditorInfoCompat
import androidx.core.view.inputmethod.InputConnectionCompat
import androidx.core.view.inputmethod.InputContentInfoCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.*
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeChatTest {
    @get:Rule val compose = createEmptyComposeRule()
    @get:Rule val microphone = GrantPermissionRule.grant(android.Manifest.permission.RECORD_AUDIO)
    private lateinit var server: MockWebServer
    private lateinit var scenario: ActivityScenario<MainActivity>
    private val requests = CopyOnWriteArrayList<RecordedRequest>()
    @Volatile private var pendingQuestion: JSONObject? = null
    @Volatile private var selectedMode = "default"
    @Volatile private var rejectMessage = false
    @Volatile private var messageDelayMs = 0L
    @Volatile private var dictationOriginal = "please uh check the image and fix the layout"
    @Volatile private var receiptConfirmed = false
    @Volatile private var liveSocket: okhttp3.WebSocket? = null
    private val ctx
        get() = ApplicationProvider.getApplicationContext<Context>()

    private val session =
        """{"id":"test-session","sessionName":"Mobile clipboard check","project":"Relay","hostId":"Fred","harness":"dsh","agentPreset":"haxor","model":"fred/flash-next","cwd":"/home/crogers2287/harnessrc","status":"working","connected":true,"capabilities":{"readConversation":true,"sendMessage":true,"steerActiveTurn":true,"queueTask":true,"attachFiles":true,"answerQuestion":true}}"""

    @Before
    fun setup() {
        requests.clear()
        selectedMode = "default"
        server = MockWebServer()
        server.dispatcher =
            object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    requests.add(request)
                    val path = request.path ?: ""
                    if (path == "/ws")
                        return MockResponse()
                            .withWebSocketUpgrade(
                                object : WebSocketListener() {
                                    override fun onOpen(
                                        webSocket: okhttp3.WebSocket,
                                        response: okhttp3.Response,
                                    ) {
                                        liveSocket = webSocket
                                    }

                                    override fun onClosing(
                                        webSocket: okhttp3.WebSocket,
                                        code: Int,
                                        reason: String,
                                    ) {
                                        webSocket.close(code, reason)
                                    }
                                }
                            )
                    if (path.endsWith("/messages") && rejectMessage)
                        return MockResponse()
                            .setResponseCode(503)
                            .setBody("{\"error\":\"Connection lost\"}")
                    if (path == "/api/interactions/question-1/respond") pendingQuestion = null
                    if (path.endsWith("/mode") && request.method == "POST") selectedMode = JSONObject(request.body.clone().readUtf8()).getString("value")
                    val body =
                        when {
                            path == "/api/launch/profiles" -> """{"profiles":[{"id":"test","label":"Claude","connected":true,"projectHome":"/home/test","models":[],"permissions":[{"id":"plan","name":"Plan","description":"Plan before changes."}]}]}"""
                            path == "/api/launch/folders" -> """{"path":"/home/test/Phone project"}"""
                            path == "/api/launch" -> """{"requestId":"test","status":"started","terminalId":"new-terminal"}"""
                            path.endsWith("/mode") -> """{"supported":true,"current":"$selectedMode","options":[{"value":"default","name":"Build"},{"value":"plan","name":"Plan","description":"Applies to subsequent turns."}]}"""
                            path.endsWith("/permissions") -> """{"supported":false,"options":[],"reason":"Test session uses host permissions."}"""
                            path == "/api/sessions" -> "{\"sessions\":[$session]}"
                            path == "/api/voice" -> "{\"enabled\":true,\"maxSeconds\":180}"
                            path == "/api/sessions/test-session" ->
                                "{\"session\":$session,\"interactions\":[${pendingQuestion?.toString() ?: ""}],\"tasks\":[]}"
                            path.contains("/events?") ->
                                """{"events":[{"id":"greeting","sequence":1,"kind":"assistant.message","data":{"text":"Your agents, wherever you are.\n\nPaste a screenshot from your keyboard, attach a file, or dictate your next instruction. I’ll keep working on Fred."}}]}"""
                            path.contains("/attachments?") ->
                                """{"attachment":{"id":"11111111-1111-4111-8111-111111111111","name":"Screenshot.png","mime":"image/png","size":128}}"""
                            path.contains("/dictation?") ->
                                json("text" to "Please check the image and fix the layout.", "original" to dictationOriginal, "cleaned" to true).toString()
                            path.endsWith("/messages") -> """{"mode":"steer"}"""
                            path.contains("message-receipts") ->
                                """{"nativeSeen":false,"confirmed":$receiptConfirmed}"""
                            else -> "{}"
                        }
                    return MockResponse()
                        .setHeader("Content-Type", "application/json")
                        .setBodyDelay(if (path.endsWith("/messages")) messageDelayMs else 0L, java.util.concurrent.TimeUnit.MILLISECONDS)
                        .setBody(body)
                }
            }
        server.start()
        ctx.getSharedPreferences("relay", 0)
            .edit()
            .clear()
            .putString("endpoint", server.url("/").toString().trimEnd('/'))
            .commit()
        File(ctx.filesDir, "conversations").deleteRecursively()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        compose.waitUntil(15000) { requests.any { it.path?.contains("/events?") == true } }
        compose.onNodeWithContentDescription("Add attachment").assertExists()
    }

    @After
    fun teardown() {
        scenario.close()
        server.shutdown()
    }

    private fun find(view: View): RichComposer? {
        if (view is RichComposer) return view
        if (view is ViewGroup)
            for (i in 0 until view.childCount) find(view.getChildAt(i))?.let {
                return it
            }
        return null
    }

    private fun imageUri(): android.net.Uri {
        val file = File(ctx.cacheDir, "shared/test.png").apply { parentFile!!.mkdirs() }
        Bitmap.createBitmap(40, 40, Bitmap.Config.ARGB_8888)
            .apply { eraseColor(android.graphics.Color.rgb(36, 107, 96)) }
            .let { bitmap ->
                file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
            }
        return FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", file)
    }

    @Test
    fun confirmedReceiptUnlocksComposerWithoutResendingOrLosingNewDraft() {
        rejectMessage = true
        scenario.onActivity { find(it.window.decorView)!!.setText("Original request") }
        compose.onNodeWithContentDescription("Steer instruction").performClick()
        compose.waitUntil(15000) {
            compose.onAllNodesWithText("Retry safely").fetchSemanticsNodes().isNotEmpty()
        }
        scenario.onActivity { find(it.window.decorView)!!.setText("New draft stays here") }
        receiptConfirmed = true
        scenario.close()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        compose.waitUntil(15000) {
            requests.any { it.path?.contains("message-receipts") == true } &&
                compose
                    .onAllNodes(hasContentDescription("Steer instruction") and isEnabled())
                    .fetchSemanticsNodes()
                    .isNotEmpty()
        }
        compose.onNodeWithContentDescription("Steer instruction").assertIsEnabled()
        scenario.onActivity {
            assertEquals("New draft stays here", find(it.window.decorView)!!.text.toString())
        }
        assertEquals(1, requests.count { it.path?.endsWith("/messages") == true })
    }

    @Test
    fun taskNotificationsAndMessageTimesRenderAsConversation() {
        compose.waitUntil(10000) { liveSocket != null }
        val stamp = "2026-10-09T15:35:42Z"
        fun emit(id: String, seq: Int, kind: String, text: String) {
            liveSocket!!.send(
                json(
                        "type" to "event",
                        "event" to
                            json(
                                "id" to id,
                                "sequence" to seq,
                                "sessionId" to "test-session",
                                "timestamp" to stamp,
                                "kind" to kind,
                                "data" to json("text" to text),
                            ),
                    )
                    .toString()
            )
        }
        emit("sent-time", 100, "user.message", "Check the build")
        emit("reply-time", 101, "assistant.message", "The build passed")
        emit(
            "task-time",
            102,
            "user.message",
            "<task-notification><status>completed</status><summary>Checks complete</summary><result>All tests passed</result></task-notification>",
        )
        compose.waitUntil(10000) {
            compose
                .onAllNodesWithText("Background task completed")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose.onNodeWithText("Sent · ${messageTimestamp(stamp)}").assertExists()
        assertEquals(
            2,
            compose
                .onAllNodesWithText("Received · ${messageTimestamp(stamp)}")
                .fetchSemanticsNodes()
                .size,
        )
        compose.onNodeWithText("Background task completed").performClick()
        compose.onNodeWithText("All tests passed").assertExists()
        InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().let { bitmap ->
            File(ctx.getExternalFilesDir(null), "native-message-times.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            bitmap.recycle()
        }

        compose.onNodeWithText("<task-notification>", substring = true).assertDoesNotExist()
    }

    @Test
    fun launcherResumeDoesNotImport() {
        scenario.onActivity {
            it.onNewIntent(Intent(it, MainActivity::class.java).setAction(Intent.ACTION_MAIN))
        }
        compose.onNodeWithText("Add to this conversation?").assertDoesNotExist()
        scenario.recreate()
        compose.onNodeWithText("Add to this conversation?").assertDoesNotExist()
        assertFalse(requests.any { it.path?.endsWith("/messages") == true })
    }

    @Test
    fun incomingMessagesAndToolsPreserveHistoryPositionUntilLatestIsTapped() {
        compose.waitUntil(10000) { liveSocket != null }
        fun emit(index: Int, kind: String = "assistant.message") {
            val event =
                JSONObject()
                    .put("id", "scroll-$index")
                    .put("sequence", index + 10)
                    .put("sessionId", "test-session")
                    .put("kind", kind)
                    .put(
                        "data",
                        JSONObject()
                            .put(
                                "text",
                                "History message $index\n" + "Readable history. ".repeat(30),
                            ),
                    )
            liveSocket!!.send(JSONObject().put("type", "event").put("event", event).toString())
        }
        for (i in 1..25) emit(i)
        Thread.sleep(800)
        compose.waitForIdle()
        compose.onNodeWithTag("conversation").performTouchInput { swipeDown() }
        compose.waitForIdle()
        fun position() =
            compose
                .onNodeWithTag("conversation")
                .fetchSemanticsNode()
                .config[SemanticsProperties.VerticalScrollAxisRange]
                .value()
        val before = position()
        compose.onNodeWithContentDescription("Latest messages").assertExists()
        emit(26)
        emit(27, "tool.invocation")
        Thread.sleep(500)
        compose.waitForIdle()
        assertEquals(before, position(), 0.001f)
        // Periodic native state refreshes and turn completion must not restart following.
        repeat(3) {
            liveSocket!!.send(
                JSONObject()
                    .put("type", "invalidate")
                    .put(
                        "sessions",
                        org.json.JSONArray().put(JSONObject(session).put("status", "idle")),
                    )
                    .toString()
            )
            Thread.sleep(400)
            compose.waitForIdle()
            assertEquals(before, position(), 0.001f)
        }

        compose.onNodeWithContentDescription("Latest messages").performClick()
        compose.waitForIdle()
        assertTrue(position() > before)
    }

    @Test
    fun androidKeyboardCommitContentUploadsOneImageAndPreservesDraft() {
        val uri = imageUri()
        scenario.onActivity { activity ->
            val field = find(activity.window.decorView)!!
            field.requestFocus()
            field.setText("Keep my text")
            val editor = EditorInfo()
            val connection = field.onCreateInputConnection(editor)!!
            assertTrue(EditorInfoCompat.getContentMimeTypes(editor).contains("image/*"))
            val accepted =
                InputConnectionCompat.commitContent(
                    connection,
                    editor,
                    InputContentInfoCompat(
                        uri,
                        ClipDescription("Screenshot", arrayOf("image/png")),
                        null,
                    ),
                    0,
                    null,
                )
            assertTrue(accepted)
        }
        compose.waitUntil(15000) {
            requests.count { it.path?.contains("/attachments?") == true } == 1
        }
        compose.waitUntil(10000) {
            compose.onAllNodesWithText("Screenshot.png").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Screenshot.png").assertExists()
        scenario.onActivity {
            assertEquals("Keep my text", find(it.window.decorView)!!.text.toString())
        }
        assertFalse(requests.any { it.path?.endsWith("/messages") == true })
    }

    @Test
    fun longPressPasteUsesAndroidClipboardImage() {
        val uri = imageUri()
        scenario.onActivity { activity ->
            val field = find(activity.window.decorView)!!
            field.requestFocus()
            (activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                .setPrimaryClip(ClipData.newUri(activity.contentResolver, "Image", uri))
            assertTrue(field.onTextContextMenuItem(android.R.id.paste))
        }
        compose.waitUntil(15000) { requests.any { it.path?.contains("/attachments?") == true } }
        compose.waitUntil(10000) {
            compose.onAllNodesWithText("Screenshot.png").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Screenshot.png").assertExists()
    }

    @Test
    fun nativeRecordingTranscribesIntoDraftWithoutSending() {
        compose.onNodeWithContentDescription("Dictate message").performClick()
        compose.onNodeWithText("Finish dictation").assertExists()
        Thread.sleep(
            1500
        ) // Record actual emulator microphone input; service response is deterministic.
        compose.onNodeWithText("Finish dictation").performClick()
        compose.waitUntil(15000) { requests.any { it.path?.contains("/dictation?") == true } }
        compose.waitUntil(15000) {
            var text = ""
            scenario.onActivity { text = find(it.window.decorView)!!.text.toString() }
            text.contains("Please check the image")
        }
        assertTrue(requests.first { it.path?.contains("/dictation?") == true }.bodySize > 100)
        assertFalse(requests.any { it.path?.endsWith("/messages") == true })
    }

    @Test
    fun launchCreatesProjectAndRequiresPermissionConfirmation() {
        scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithText("New session").performClick()
        compose.waitUntil(15000) { compose.onAllNodesWithText("New project folder").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("New project folder").performScrollTo().performClick()
        compose.onNodeWithText("Project folder name").performScrollTo().performTextInput("Phone project")
        compose.onNodeWithText("Create and use folder").performScrollTo().performClick()
        compose.waitUntil(15000) { requests.any { it.path == "/api/launch/folders" } }
        compose.onNodeWithText("Use host default").performScrollTo().performClick()
        compose.onNodeWithText("Plan", useUnmergedTree = true).performClick()
        compose.onNodeWithText("First instruction").performScrollTo().performTextInput("Plan my project")
        compose.onNodeWithText("Start session").performScrollTo().assertIsNotEnabled()
        compose.onNode(isToggleable()).performScrollTo().performClick()
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        compose.waitForIdle()
        InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().let { bitmap ->
            File(ctx.getExternalFilesDir(null), "native-launch.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
        compose.onNodeWithText("Start session").performScrollTo().performClick()
        compose.waitUntil(15000) { requests.any { it.path == "/api/launch" && it.method == "POST" } }
        val body = JSONObject(requests.first { it.path == "/api/launch" && it.method == "POST" }.body.clone().readUtf8())
        assertEquals("plan", body.getString("permission"))
        assertTrue(body.getBoolean("permissionConfirmed"))
        assertEquals("/home/test/Phone project", body.getString("cwd"))
    }

    @Test
    fun firstBackOpensDrawerAndSteerHasNoQueueRequest() {
        scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithText("New session").assertExists()
        compose.onNodeWithContentDescription("Close sessions").performClick()
        scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithText("New session").assertExists()
        compose.onNodeWithContentDescription("Close sessions").performClick()
        scenario.onActivity { find(it.window.decorView)!!.setText("Change the layout") }
        compose.onNodeWithContentDescription("Steer instruction").performClick()
        compose.waitUntil(15000) { requests.any { it.path?.endsWith("/messages") == true } }
        assertFalse(requests.any { it.path?.endsWith("/tasks") == true })
        val body =
            JSONObject(requests.first { it.path?.endsWith("/messages") == true }.body.readUtf8())
        assertEquals("Change the layout", body.getString("prompt"))
        assertTrue(body.getString("idempotencyKey").length == 36)
    }

    @Test
    fun draftSurvivesActivityRecreationAndNativeLayout() {
        scenario.onActivity { find(it.window.decorView)!!.setText("A draft worth keeping") }
        scenario.recreate()
        compose.waitUntil(10000) {
            compose
                .onAllNodesWithContentDescription("Add attachment")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        scenario.onActivity {
            assertEquals("A draft worth keeping", find(it.window.decorView)!!.text.toString())
        }
        compose.waitUntil(10000) {
            var ready = false
            scenario.onActivity { ready = it.model.connected }
            ready
        }
        InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().let { bitmap ->
            File(ctx.getExternalFilesDir(null), "native-chat.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            bitmap.recycle()
        }
        compose.waitUntil(10000) {
            var focused = false
            scenario.onActivity { focused = it.window.decorView.hasWindowFocus() }
            focused
        }
        androidx.test.espresso.Espresso.onView(
                androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom(
                    RichComposer::class.java
                )
            )
            .perform(androidx.test.espresso.action.ViewActions.click())
        compose.waitUntil(10000) {
            var visible = false
            scenario.onActivity {
                visible =
                    androidx.core.view.ViewCompat.getRootWindowInsets(it.window.decorView)
                        ?.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime()) == true
            }
            visible
        }
        InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().let { bitmap ->
            File(ctx.getExternalFilesDir(null), "native-keyboard.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            bitmap.recycle()
        }
        compose.mainClock.advanceTimeBy(1000)
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Open sessions").assertDoesNotExist()
        var keyboardTop = 0
        scenario.onActivity { activity ->
            val insets =
                androidx.core.view.ViewCompat.getRootWindowInsets(activity.window.decorView)!!
            keyboardTop =
                activity.window.decorView.height -
                    insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime()).bottom
        }
        assertTrue(
            "Send control must stay above the keyboard",
            compose
                .onNodeWithContentDescription("Steer instruction")
                .fetchSemanticsNode()
                .boundsInWindow
                .bottom <= keyboardTop + 1,
        )
    }

    @Test
    fun questionResponseTargetsNativeRequestAndDoesNotSendChat() {
        pendingQuestion =
            JSONObject(
                """{"id":"question-1","type":"single-choice","route":"dsh-native","status":"pending","expiresAt":"2099-01-01T00:00:00.000Z","prompt":"Which plan should I use?","metadata":{"dshQuestions":[{"id":"plan","question":"Which plan should I use?","options":[{"label":"Alpha"},{"label":"Beta"}]}]}}"""
            )
        scenario.onActivity { it.model.reload() }
        compose.waitUntil(15000) {
            compose.onAllNodesWithText("Alpha").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Alpha").performScrollTo().performClick()
        compose.onNodeWithText("Send response").performScrollTo().performClick()
        compose.waitUntil(15000) {
            requests.any { it.path == "/api/interactions/question-1/respond" }
        }
        val value =
            JSONObject(
                requests.first { it.path == "/api/interactions/question-1/respond" }.body.readUtf8()
            )
        assertEquals(
            "Alpha",
            value
                .getJSONObject("response")
                .getJSONArray("answers")
                .getJSONObject(0)
                .getJSONArray("selected")
                .getString(0),
        )
        assertFalse(requests.any { it.path?.endsWith("/messages") == true })
    }

    @Test
    fun sessionPlanModeRequiresConfirmationAndUsesSettingsRoute() {
        compose.onNodeWithContentDescription("Session details").performClick()
        compose.waitUntil(15000) { compose.onAllNodesWithText("Plan").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Plan").performScrollTo().performClick()
        assertFalse(requests.any { it.path?.endsWith("/mode") == true && it.method == "POST" })
        compose.onNodeWithText("Apply settings").performClick()
        compose.waitUntil(15000) { requests.any { it.path?.endsWith("/mode") == true && it.method == "POST" } }
        val body = JSONObject(requests.first { it.path?.endsWith("/mode") == true && it.method == "POST" }.body.readUtf8())
        assertEquals("plan", body.getString("value"))
        assertEquals("default", body.getString("expected"))
        assertTrue(body.getBoolean("confirm"))
        assertFalse(requests.any { it.path?.endsWith("/messages") == true })
    }

    @Test
    fun codexQuestionUsesStructuredAnswersWithoutSendingChat() {
        pendingQuestion = JSONObject(
            """{"id":"question-1","type":"free-text","route":"codex-native","status":"pending","expiresAt":"2099-01-01T00:00:00.000Z","prompt":"Which color?","metadata":{"questions":[{"id":"color","question":"Which color?","options":[{"label":"Blue","description":"Use blue"},{"label":"Green","description":"Use green"}]}]}}"""
        )
        scenario.onActivity { it.model.reload() }
        compose.waitUntil(15000) {
            compose.onAllNodesWithText("Blue").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Blue").performScrollTo().performClick()
        compose.onNodeWithText("Send response").performScrollTo().performClick()
        compose.waitUntil(15000) { requests.any { it.path == "/api/interactions/question-1/respond" } }
        val body = JSONObject(requests.first { it.path == "/api/interactions/question-1/respond" }.body.readUtf8())
        assertEquals("Blue", body.getJSONObject("response").getJSONObject("answers").getJSONObject("color").getJSONArray("answers").getString(0))
        assertFalse(requests.any { it.path?.endsWith("/messages") == true })
    }

    @Test
    fun codexCommandApprovalHasChoicesAndTargetsOnlyTheInteraction() {
        pendingQuestion =
            JSONObject(
                """{"id":"question-1","type":"command-approval","route":"codex-native","status":"pending","expiresAt":"2099-01-01T00:00:00.000Z","prompt":"touch example","choices":[{"id":"accept","label":"Allow once"},{"id":"cancel","label":"Deny and stop turn"}]}"""
            )
        scenario.onActivity { it.model.reload() }
        compose.waitUntil(15000) {
            compose.onAllNodesWithText("Allow once").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Deny and stop turn").performScrollTo().performClick()
        compose.waitUntil(15000) {
            requests.any { it.path == "/api/interactions/question-1/respond" }
        }
        val body =
            JSONObject(
                requests.first { it.path == "/api/interactions/question-1/respond" }.body.readUtf8()
            )
        assertEquals("cancel", body.getString("response"))
        assertFalse(requests.any { it.path?.endsWith("/messages") == true })
    }

    @Test
    fun markdownLinkTapOpensDownloadAndLongPressKeepsSelection() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val filter =
            IntentFilter(Intent.ACTION_VIEW).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
                addDataScheme("https")
            }
        val monitor =
            instrumentation.addMonitor(
                filter,
                android.app.Instrumentation.ActivityResult(0, null),
                true,
            )
        try {
            scenario.onActivity { activity ->
                activity.setContentView(
                    androidx.compose.ui.platform.ComposeView(activity).apply {
                        setContent {
                            androidx.compose.foundation.layout.Box(
                                androidx.compose.ui.Modifier.padding(top = 80.dp)
                            ) {
                                MarkdownText("[Download Relay](https://example.com/relay.apk)")
                            }
                        }
                    }
                )
            }
            compose.waitForIdle()
            val matcher: org.hamcrest.Matcher<View> =
                org.hamcrest.CoreMatchers.instanceOf(SelectableMarkdownView::class.java)
            val coordinates =
                androidx.test.espresso.action.CoordinatesProvider { view ->
                    val text = view as android.widget.TextView
                    val position = IntArray(2)
                    view.getLocationOnScreen(position)
                    floatArrayOf(
                        position[0] + text.totalPaddingLeft + text.layout.getPrimaryHorizontal(5),
                        position[1] + text.totalPaddingTop + text.layout.getLineBottom(0) / 2f,
                    )
                }
            androidx.test.espresso.Espresso.onView(matcher)
                .perform(
                    androidx.test.espresso.action.GeneralClickAction(
                        androidx.test.espresso.action.Tap.SINGLE,
                        coordinates,
                        androidx.test.espresso.action.Press.FINGER,
                    )
                )
            assertEquals(1, monitor.hits)
            androidx.test.espresso.Espresso.onView(matcher)
                .perform(
                    androidx.test.espresso.action.GeneralClickAction(
                        androidx.test.espresso.action.Tap.LONG,
                        coordinates,
                        androidx.test.espresso.action.Press.FINGER,
                    )
                )
            assertEquals("Long press must not open the link", 1, monitor.hits)
            androidx.test.espresso.Espresso.onView(matcher).check { view, error ->
                if (error != null) throw error
                val text = view as android.widget.TextView
                assertTrue(text.isTextSelectable)
                assertTrue("Long press selects text", text.selectionEnd > text.selectionStart)
            }
        } finally {
            instrumentation.removeMonitor(monitor)
        }
    }

    private fun dictate(original: String) {
        dictationOriginal = original
        val file = File.createTempFile("voice-test", ".m4a", ctx.cacheDir).apply { writeBytes(ByteArray(256)) }
        scenario.onActivity { it.model.transcribe(file) }
        compose.waitUntil(10000) {
            var done = false
            scenario.onActivity { done = !it.model.transcribing && it.model.voiceOriginal == original }
            done
        }
    }

    @Test
    fun submittedDictationClearsImmediatelyButLateReceiptKeepsNewIdenticalDraft() {
        messageDelayMs = 1200
        val prompt = "  Check this project.  "
        dictate("uh check this project")
        scenario.onActivity { it.model.edit(prompt) }
        compose.onNodeWithText("Original transcription").assertExists()
        compose.onNodeWithContentDescription("Steer instruction").performClick()
        compose.waitUntil(10000) {
            var empty = false
            scenario.onActivity { empty = find(it.window.decorView)!!.text.isNullOrEmpty() }
            empty
        }
        compose.onNodeWithText("Original transcription").assertDoesNotExist()
        dictate("a new recording")
        scenario.onActivity { it.model.edit(prompt) }
        compose.waitUntil(10000) { var done = false; scenario.onActivity { done = !it.model.sending }; done }
        receiptConfirmed = true
        scenario.onActivity { it.model.reload() }
        compose.waitUntil(10000) { var done = false; scenario.onActivity { done = it.model.outgoing == null }; done }
        scenario.onActivity {
            assertEquals(prompt, it.model.draft)
            assertEquals("a new recording", it.model.voiceOriginal)
        }
        assertEquals(1, requests.count { it.path?.endsWith("/messages") == true })
    }

    @Test
    fun failedDictationRestoresDraftAndWhitespaceRetryClearsBoth() {
        rejectMessage = true
        val prompt = "  Preserve this recording.  "
        dictate("um preserve this recording")
        scenario.onActivity { it.model.edit(prompt) }
        compose.onNodeWithContentDescription("Steer instruction").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText("Retry safely").fetchSemanticsNodes().isNotEmpty() }
        scenario.onActivity {
            assertEquals(prompt, it.model.draft)
            assertEquals("um preserve this recording", it.model.voiceOriginal)
        }
        scenario.recreate()
        compose.waitUntil(10000) { compose.onAllNodesWithText("Retry safely").fetchSemanticsNodes().isNotEmpty() }
        rejectMessage = false
        compose.onNodeWithText("Retry safely").performScrollTo().performClick()
        compose.waitUntil(10000) { var done = false; scenario.onActivity { done = !it.model.sending && it.model.draft.isEmpty() }; done }
        scenario.onActivity {
            assertEquals("", find(it.window.decorView)!!.text.toString())
            assertEquals("", it.model.voiceOriginal)
        }
        compose.onNodeWithText("Original transcription").assertDoesNotExist()
    }

    @Test
    fun uncertainSendIsPersistedAndRetriedWithSameIdentity() {
        rejectMessage = true
        scenario.onActivity { find(it.window.decorView)!!.setText("Keep this request") }
        compose.onNodeWithContentDescription("Steer instruction").performClick()
        compose.waitUntil(15000) {
            compose.onAllNodesWithText("Retry safely").fetchSemanticsNodes().isNotEmpty()
        }
        scenario.close()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        compose.waitUntil(15000) {
            compose.onAllNodesWithText("Retry safely").fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals(1, requests.count { it.path?.endsWith("/messages") == true })
        rejectMessage = false
        scenario.onActivity { find(it.window.decorView)!!.setText("Keep this newer draft") }
        compose.onNodeWithText("Retry safely").performScrollTo().performClick()
        compose.waitUntil(15000) { requests.count { it.path?.endsWith("/messages") == true } == 2 }
        val sent =
            requests
                .filter { it.path?.endsWith("/messages") == true }
                .map { JSONObject(it.body.readUtf8()) }
        assertEquals(sent[0].getString("idempotencyKey"), sent[1].getString("idempotencyKey"))
        compose.waitForIdle()
        scenario.onActivity {
            assertEquals("Keep this newer draft", find(it.window.decorView)!!.text.toString())
        }
    }
}
