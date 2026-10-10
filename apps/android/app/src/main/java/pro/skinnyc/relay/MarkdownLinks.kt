package pro.skinnyc.relay

import android.content.Context
import android.content.Intent
import android.text.Spanned
import android.text.style.ClickableSpan
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.widget.Toast
import androidx.appcompat.widget.AppCompatTextView
import kotlin.math.abs
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Keep native long-press selection while allowing short taps on Markdown links. */
class SelectableMarkdownView(context: Context) : AppCompatTextView(context) {
    private var pressedLink: ClickableSpan? = null
    private var startX = 0f
    private var startY = 0f
    private var started = 0L
    private val slop = ViewConfiguration.get(context).scaledTouchSlop

    private fun linkAt(event: MotionEvent): ClickableSpan? {
        val content = text as? Spanned ?: return null
        val layout = layout ?: return null
        val x = event.x - totalPaddingLeft + scrollX
        val y = event.y - totalPaddingTop + scrollY
        if (y < 0 || y > layout.height) return null
        val line = layout.getLineForVertical(y.toInt())
        if (x < layout.getLineLeft(line) || x > layout.getLineRight(line)) return null
        val offset = layout.getOffsetForHorizontal(line, x)
        return content.getSpans(offset, offset, ClickableSpan::class.java).firstOrNull()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                pressedLink = linkAt(event)
                startX = event.x
                startY = event.y
                started = event.eventTime
            }
            MotionEvent.ACTION_MOVE -> {
                if (abs(event.x - startX) > slop || abs(event.y - startY) > slop) pressedLink = null
            }
            MotionEvent.ACTION_CANCEL -> pressedLink = null
            MotionEvent.ACTION_UP -> {
                val link = pressedLink
                pressedLink = null
                if (
                    link != null &&
                        link === linkAt(event) &&
                        event.eventTime - started < ViewConfiguration.getLongPressTimeout()
                ) {
                    // Complete TextView's normal touch bookkeeping, then follow exactly once.
                    super.onTouchEvent(event)
                    link.onClick(this)
                    return true
                }
            }
        }
        return super.onTouchEvent(event)
    }
}

fun resolveChatLink(base: String, destination: String): String? {
    // No file:, javascript:, intent: or content: launches from model-generated Markdown.
    return base
        .toHttpUrlOrNull()
        ?.resolve(destination)
        ?.takeIf { it.username.isEmpty() && it.password.isEmpty() }
        ?.toString()
}

fun openChatLink(context: Context, base: String, destination: String) {
    val url = resolveChatLink(base, destination)
    if (url == null) {
        Toast.makeText(
                context,
                "This link cannot be opened. Ask the agent to publish the file as an attachment.",
                Toast.LENGTH_LONG,
            )
            .show()
        return
    }
    try {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
            }
        )
    } catch (_: android.content.ActivityNotFoundException) {
        Toast.makeText(context, "No browser is available to open this link.", Toast.LENGTH_LONG)
            .show()
    }
}
