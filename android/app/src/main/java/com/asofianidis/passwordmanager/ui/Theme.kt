package com.asofianidis.passwordmanager.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** The desktop app's graphite theme (src/renderer/src/assets/main.css). */
object Palette {
    val canvas = Color(0xFF0A0B0A)
    val panel = Color(0xFF111311)
    val raised = Color(0xFF171A17)
    val hover = Color(0xFF1D211D)
    val sel = Color(0xFF242924)
    val line = Color(0xFF20241F)
    val lineStrong = Color(0xFF2D322C)
    val bright = Color(0xFFEEF1EA)
    val fg = Color(0xFFC3C8BE)
    val muted = Color(0xFF858C81)
    val faint = Color(0xFF50564D)
    val accent = Color(0xFFC4F042)
    val accentFg = Color(0xFF11160A)
    val danger = Color(0xFFFF6E61)
    val warn = Color(0xFFF2B84B)
    val ok = Color(0xFF4FD99B)
    val info = Color(0xFF85A9FF)
}

private val colors = darkColorScheme(
    primary = Palette.accent,
    onPrimary = Palette.accentFg,
    primaryContainer = Palette.sel,
    onPrimaryContainer = Palette.bright,
    secondary = Palette.fg,
    onSecondary = Palette.canvas,
    secondaryContainer = Palette.sel,
    onSecondaryContainer = Palette.bright,
    tertiary = Palette.info,
    background = Palette.canvas,
    onBackground = Palette.fg,
    surface = Palette.canvas,
    onSurface = Palette.bright,
    surfaceVariant = Palette.raised,
    onSurfaceVariant = Palette.muted,
    surfaceContainerLowest = Palette.canvas,
    surfaceContainerLow = Palette.panel,
    surfaceContainer = Palette.panel,
    surfaceContainerHigh = Palette.raised,
    surfaceContainerHighest = Palette.hover,
    outline = Palette.lineStrong,
    outlineVariant = Palette.line,
    error = Palette.danger,
    onError = Palette.canvas,
    errorContainer = Color(0xFF3A1714),
    onErrorContainer = Palette.danger,
)

@Composable
fun PmTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, content = content)
}
