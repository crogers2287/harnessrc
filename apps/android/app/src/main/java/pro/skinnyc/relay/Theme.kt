package pro.skinnyc.relay

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp

private val Light =
    lightColorScheme(
        primary = Color(0xFF246B60),
        onPrimary = Color.White,
        primaryContainer = Color(0xFFE2EFEB),
        onPrimaryContainer = Color(0xFF164B43),
        background = Color(0xFFFFFEFC),
        surface = Color(0xFFFFFEFC),
        surfaceVariant = Color(0xFFF1F1ED),
        onSurface = Color(0xFF222925),
        onSurfaceVariant = Color(0xFF606B65),
        outline = Color(0xFF7C8881),
        outlineVariant = Color(0xFFE0E4DE),
    )
private val Dark =
    darkColorScheme(
        primary = Color(0xFF91CDBE),
        onPrimary = Color(0xFF123C33),
        primaryContainer = Color(0xFF254D42),
        onPrimaryContainer = Color(0xFFD3EADF),
        background = Color(0xFF171B19),
        surface = Color(0xFF171B19),
        surfaceVariant = Color(0xFF262D28),
        onSurface = Color(0xFFE8EDE6),
        onSurfaceVariant = Color(0xFFB4BFB7),
        outlineVariant = Color(0xFF39463D),
    )

@Composable
fun RelayTheme(mode: String = "system", accent: String = "teal", content: @Composable () -> Unit) {
    val dark = when (mode) {
        "light" -> false
        "dark" -> true
        else -> isSystemInDarkTheme()
    }
    val primary = when (accent) {
        "blue" -> if (dark) Color(0xFFA5C8FF) else Color(0xFF1759A6)
        "violet" -> if (dark) Color(0xFFD0BCFF) else Color(0xFF6542A6)
        "amber" -> if (dark) Color(0xFFFFD18A) else Color(0xFF8A4F00)
        else -> if (dark) Color(0xFF91CDBE) else Color(0xFF246B60)
    }
    val onPrimary = when (accent) {
        "blue" -> if (dark) Color(0xFF10233F) else Color.White
        "violet" -> if (dark) Color(0xFF24143F) else Color.White
        "amber" -> if (dark) Color(0xFF382307) else Color.White
        else -> if (dark) Color(0xFF123C33) else Color.White
    }
    val base = if (dark) Dark else Light
    val scheme = base.copy(
        primary = primary,
        onPrimary = onPrimary,
        primaryContainer = if (dark) primary.copy(alpha = 0.22f) else primary.copy(alpha = 0.12f),
        onPrimaryContainer = primary,
    )
    MaterialTheme(
        colorScheme = scheme,
        typography =
            Typography(
                bodyLarge =
                    TextStyle(
                        fontFamily = FontFamily.SansSerif,
                        fontSize = 17.sp,
                        lineHeight = 26.sp,
                    ),
                bodyMedium =
                    TextStyle(
                        fontFamily = FontFamily.SansSerif,
                        fontSize = 15.sp,
                        lineHeight = 22.sp,
                    ),
            ),
        content = content,
    )
}
