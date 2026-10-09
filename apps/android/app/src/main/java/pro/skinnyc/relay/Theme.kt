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
fun RelayTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) Dark else Light,
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
