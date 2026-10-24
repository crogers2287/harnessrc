package pro.skinnyc.relay

import android.content.Context
import android.content.Intent
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.KeyEvent
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import androidx.appcompat.widget.AppCompatEditText
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.ViewCompat
import java.io.File

/** Android's native receive-content pipeline, including IME commitContent and long-press paste. */
class RichComposer(context: Context) : AppCompatEditText(context) {
    var changed: (String) -> Unit = {}
    var receiveFile: (Uri, Any?) -> Unit = { _, _ -> }
    var submit: () -> Unit = {}
    var escape: () -> Unit = {}
    private var updating = false

    init {
        contentDescription = "Message your agent"
        setTextSize(17f)
        setPadding(0, 8, 0, 8)
        gravity = Gravity.TOP or Gravity.START
        background = null
        inputType =
            InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        imeOptions = EditorInfo.IME_ACTION_SEND or EditorInfo.IME_FLAG_NO_EXTRACT_UI
        minLines = 1
        maxLines = 6
        setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_SEND && !composingText()) {
                submit()
                true
            } else false
        }
        addTextChangedListener(
            object : TextWatcher {
                override fun beforeTextChanged(
                    s: CharSequence?,
                    start: Int,
                    count: Int,
                    after: Int,
                ) {}

                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    if (!updating) changed(s.toString())
                }

                override fun afterTextChanged(s: Editable?) {}
            }
        )
        ViewCompat.setOnReceiveContentListener(this, arrayOf("image/*")) { _, payload ->
            val split = payload.partition { it.uri?.scheme == "content" }
            split.first?.let { content ->
                for (i in 0 until content.clip.itemCount) receiveFile(
                    content.clip.getItemAt(i).uri,
                    payload,
                )
            }
            split.second // Leave text and unsupported data to Android's normal editor behavior.
        }
    }

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val connection = super.onCreateInputConnection(outAttrs)
        outAttrs.imeOptions = outAttrs.imeOptions and EditorInfo.IME_FLAG_NO_ENTER_ACTION.inv()
        return connection
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_ESCAPE && !composingText() && !event.isCtrlPressed && !event.isAltPressed && !event.isMetaPressed && !event.isShiftPressed) {
            if (event.repeatCount == 0) escape()
            return true
        }
        if (keyCode == KeyEvent.KEYCODE_ENTER && !composingText() && !event.isAltPressed) {
            if (event.repeatCount == 0) {
                if (event.isCtrlPressed || event.isMetaPressed || event.isShiftPressed) {
                    val start = selectionStart.coerceAtLeast(0)
                    val end = selectionEnd.coerceAtLeast(0)
                    text?.replace(minOf(start, end), maxOf(start, end), "\n")
                } else submit()
            }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_ESCAPE || (keyCode == KeyEvent.KEYCODE_ENTER && !event.isAltPressed && !composingText())) return true
        return super.onKeyUp(keyCode, event)
    }

    private fun composingText() = text?.let { BaseInputConnection.getComposingSpanStart(it) >= 0 } == true

    fun sync(value: String) {
        if (text.toString() == value) return
        val cursor = selectionStart.coerceAtLeast(0)
        val appended = value.startsWith(text.toString())
        updating = true
        setText(value)
        setSelection(if (appended) value.length else cursor.coerceAtMost(value.length))
        updating = false
    }
}

@Composable
fun NativeComposer(
    value: String,
    color: Color,
    hintColor: Color,
    onChange: (String) -> Unit,
    onFile: (Uri, Any?) -> Unit,
    modifier: Modifier = Modifier,
    onSubmit: () -> Unit = {},
    onEscape: () -> Unit = {},
) {
    val change by rememberUpdatedState(onChange)
    val receive by rememberUpdatedState(onFile)
    val submitMessage by rememberUpdatedState(onSubmit)
    val sendEscape by rememberUpdatedState(onEscape)
    AndroidView(
        factory = { context ->
            RichComposer(android.view.ContextThemeWrapper(context, R.style.Theme_Relay)).apply {
                hint = "Message your agent…"
                changed = { change(it) }
                receiveFile = { uri, lease -> receive(uri, lease) }
                submit = { submitMessage() }
                escape = { sendEscape() }
            }
        },
        modifier = modifier,
        update = { field ->
            field.setTextColor(color.toArgb())
            field.setHintTextColor(hintColor.toArgb())
            field.sync(value)
        },
    )
}

class NativeRecorder(private val context: Context) {
    var recording by mutableStateOf(false)
        private set

    var seconds by mutableStateOf(0)
        private set

    var level by mutableStateOf(0f)
        private set

    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var started = 0L

    fun start() {
        cancel()
        val target = File.createTempFile("dictation-", ".m4a", context.cacheDir)
        val capture =
            if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context)
            else @Suppress("DEPRECATION") MediaRecorder()
        try {
            capture.setAudioSource(MediaRecorder.AudioSource.MIC)
            capture.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            capture.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            capture.setAudioEncodingBitRate(64000)
            capture.setAudioSamplingRate(44100)
            capture.setOutputFile(target.absolutePath)
            capture.prepare()
            capture.start()
            recorder = capture
            file = target
            started = System.currentTimeMillis()
            seconds = 0
            recording = true
        } catch (e: Exception) {
            capture.release()
            target.delete()
            throw e
        }
    }

    fun tick() {
        seconds = ((System.currentTimeMillis() - started) / 1000).toInt()
        level =
            runCatching { ((recorder?.maxAmplitude ?: 0) / 16000f).coerceIn(0f, 1f) }
                .getOrDefault(0f)
    }

    fun finish(): File? {
        if (!recording) return null
        val target = file
        try {
            recorder?.stop()
        } catch (_: Exception) {
            target?.delete()
        }
        recorder?.release()
        recorder = null
        file = null
        recording = false
        level = 0f
        return target?.takeIf { it.exists() && it.length() > 0 }
    }

    fun cancel() {
        finish()?.delete()
    }
}

/** Streams words into the composer while you talk, using the phone's own recognizer (on-device
 * when available). Android ends a recognition at each pause, so it restarts until finished. */
class LiveDictation(private val context: Context) {
    var recording by mutableStateOf(false)
        private set

    var seconds by mutableStateOf(0)
        private set

    var level by mutableStateOf(0f)
        private set

    val available = SpeechRecognizer.isRecognitionAvailable(context)
    var onText: (String) -> Unit = {}
    var onError: (String) -> Unit = {}
    private var recognizer: SpeechRecognizer? = null
    private var onDevice =
        Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
    private var committed = ""
    private var started = 0L

    fun start() {
        cancel()
        committed = ""
        started = System.currentTimeMillis()
        seconds = 0
        recording = true
        listen()
    }

    private fun listen() {
        val r =
            if (onDevice && Build.VERSION.SDK_INT >= 31)
                SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            else SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = r
        r.setRecognitionListener(
            object : RecognitionListener {
                override fun onPartialResults(results: Bundle) {
                    best(results)?.let { onText(join(committed, it)) }
                }

                override fun onResults(results: Bundle) {
                    best(results)?.let { committed = join(committed, it) }
                    onText(committed)
                    release(r)
                    if (recording) listen()
                }

                override fun onError(error: Int) {
                    release(r)
                    if (!recording) return
                    when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH,
                        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> listen()
                        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED,
                        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
                            if (onDevice) {
                                onDevice = false
                                listen()
                            } else stopWith("Speech recognition is not available for your language.")
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                            stopWith("Microphone permission is needed for dictation.")
                        SpeechRecognizer.ERROR_NETWORK,
                        SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
                        SpeechRecognizer.ERROR_SERVER ->
                            stopWith("Speech recognition needs a connection on this phone.")
                        else -> stopWith("Dictation stopped (error $error).")
                    }
                }

                override fun onRmsChanged(rmsdB: Float) {
                    level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
                }

                override fun onReadyForSpeech(params: Bundle?) {}

                override fun onBeginningOfSpeech() {}

                override fun onBufferReceived(buffer: ByteArray?) {}

                override fun onEndOfSpeech() {}

                override fun onEvent(eventType: Int, params: Bundle?) {}
            }
        )
        r.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                )
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                if (Build.VERSION.SDK_INT >= 33)
                    putExtra(
                        RecognizerIntent.EXTRA_ENABLE_FORMATTING,
                        RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY,
                    )
            }
        )
    }

    private fun best(results: Bundle) =
        results
            .getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()
            ?.takeIf { it.isNotBlank() }

    private fun join(a: String, b: String) = listOf(a, b).filter { it.isNotBlank() }.joinToString(" ")

    private fun release(r: SpeechRecognizer) {
        r.destroy()
        if (recognizer === r) recognizer = null
    }

    private fun stopWith(message: String) {
        recording = false
        level = 0f
        onError(message)
    }

    fun tick() {
        seconds = ((System.currentTimeMillis() - started) / 1000).toInt()
    }

    /** Stops listening; the recognizer still delivers the last words through onText. */
    fun finish() {
        if (!recording) return
        recording = false
        level = 0f
        recognizer?.stopListening()
    }

    fun cancel() {
        recording = false
        level = 0f
        recognizer?.let(::release)
    }
}
