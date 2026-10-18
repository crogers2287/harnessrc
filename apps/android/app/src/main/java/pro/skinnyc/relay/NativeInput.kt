package pro.skinnyc.relay

import android.content.Context
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.inputmethod.EditorInfo
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
        imeOptions = EditorInfo.IME_FLAG_NO_EXTRACT_UI
        minLines = 1
        maxLines = 6
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
) {
    val change by rememberUpdatedState(onChange)
    val receive by rememberUpdatedState(onFile)
    AndroidView(
        factory = { context ->
            RichComposer(android.view.ContextThemeWrapper(context, R.style.Theme_Relay)).apply {
                hint = "Message your agent…"
                changed = { change(it) }
                receiveFile = { uri, lease -> receive(uri, lease) }
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
