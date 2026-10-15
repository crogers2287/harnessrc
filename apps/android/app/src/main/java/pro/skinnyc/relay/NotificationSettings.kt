package pro.skinnyc.relay

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

@Composable
fun NotificationSettings() {
    val context = LocalContext.current
    val prefs = remember { RelayNotifications.prefs(context) }
    var revision by remember { mutableIntStateOf(0) }
    DisposableEffect(prefs) {
        val listener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> revision++ }
        prefs.registerOnSharedPreferenceChangeListener(listener)
        onDispose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    var permissionDenied by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        permissionDenied = !granted
        if (granted) RelayNotifications.toggle(context, true)
    }
    val enabled = remember(revision) { RelayNotifications.enabled(context) }
    Text("Notifications", style = MaterialTheme.typography.titleMedium)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text("Background notifications", modifier = Modifier.weight(1f))
        Switch(enabled, { value ->
            if (value && Build.VERSION.SDK_INT >= 33 && !RelayNotifications.allowed(context)) launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
            else RelayNotifications.toggle(context, value)
        }, modifier = Modifier.semantics { contentDescription = "Background notifications" })
    }
    Text("Keep Tailscale connected. A quiet Listening notification keeps Relay connected when you leave the app. Tapping an alert opens its session; question alerts open the answer tray.")
    if (permissionDenied) Text("Allow notifications in Android settings to receive alerts.", color = MaterialTheme.colorScheme.error)
    if (enabled) {
        for ((key, label) in listOf("question" to "Questions and approvals", "completion" to "Completed turns", "failure" to "Failed turns")) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(label, Modifier.weight(1f))
                Switch(remember(revision) { prefs.getBoolean("notify:$key", true) }, { prefs.edit().putBoolean("notify:$key", it).apply() }, modifier = Modifier.semantics { contentDescription = label })
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Show session names in alerts", Modifier.weight(1f))
            Switch(remember(revision) { prefs.getBoolean("notificationPreview", true) }, { prefs.edit().putBoolean("notificationPreview", it).apply() }, modifier = Modifier.semantics { contentDescription = "Show session names in alerts" })
        }
        Text("For prompt alerts while the phone sleeps, set Relay battery use to Unrestricted. Force-stopping Relay pauses delivery until you reopen it.")
        TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:${context.packageName}"))) }) { Text("Battery and app settings") }
    }
    TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)) }) { Text("Notification sounds and Android permissions") }
}
