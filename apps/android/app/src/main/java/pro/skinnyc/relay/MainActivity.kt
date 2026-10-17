package pro.skinnyc.relay

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.*

class MainActivity : ComponentActivity() {
    val model: RelayModel by viewModels()
    private var shared by mutableStateOf<Intent?>(null)
    private var keyboardVisible by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Observe before the Compose/View interoperability layer consumes insets.
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets
            ->
            keyboardVisible = insets.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime())
            insets
        }
        window.decorView.viewTreeObserver.addOnGlobalLayoutListener {
            keyboardVisible =
                androidx.core.view.ViewCompat.getRootWindowInsets(window.decorView)
                    ?.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime()) == true
        }
        shared =
            (if (savedInstanceState != null)
                    savedInstanceState.getParcelable<Intent>("pendingShare")
                else intent)
                ?.takeIf {
                    it.action == Intent.ACTION_SEND || it.action == Intent.ACTION_SEND_MULTIPLE
                }
        openNotification(intent)
        setContent {
            RelayTheme(model.colorMode, model.accentTheme) {
                RelayApp(model, shared, keyboardVisible) {
                    shared = null
                    setIntent(Intent(this, MainActivity::class.java).setAction(Intent.ACTION_MAIN))
                }
            }
        }
    }

    public override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openNotification(intent)
        if (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE) {
            setIntent(intent)
            shared = intent
        }
    }

    private fun openNotification(intent: Intent?) {
        if (intent?.action != RelayNotifications.OPEN) return
        val session = intent.getStringExtra("session").orEmpty()
        if (session.isNotBlank()) {
            model.notificationTarget = session to intent.getBooleanExtra("question", false)
            val manager = getSystemService(android.app.NotificationManager::class.java)
            for (kind in listOf("question", "completion", "failure")) manager.cancel("relay:$session:$kind", 1)
        }
        // Consume the target without replacing the Activity's original launch identity.
        intent.removeExtra("session")
        intent.removeExtra("question")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putParcelable("pendingShare", shared)
        super.onSaveInstanceState(outState)
    }

    override fun onStart() {
        super.onStart()
        model.start()
        RelayNotifications.sync(this)
    }

    override fun onStop() {
        model.stop()
        super.onStop()
    }
}
