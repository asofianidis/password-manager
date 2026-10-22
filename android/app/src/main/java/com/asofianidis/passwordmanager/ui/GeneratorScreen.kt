@file:OptIn(ExperimentalMaterial3Api::class)

package com.asofianidis.passwordmanager.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.asofianidis.passwordmanager.Generator
import com.asofianidis.passwordmanager.GeneratorOptions
import com.asofianidis.passwordmanager.pm
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

@Composable
fun GeneratorScreen() {
    val context = LocalContext.current
    val pm = context.pm
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    val generator = remember { Generator(context) }
    var options by remember { mutableStateOf(pm.settings.generator) }
    var password by remember { mutableStateOf(generator.generate(options)) }

    fun update(next: GeneratorOptions) {
        options = next
        pm.settings.generator = next
        password = generator.generate(next)
    }

    Scaffold(topBar = { TopAppBar(title = { Text("Generator") }, colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.canvas)) }) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Panel {
                Text(
                    password,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 20.sp,
                    color = Palette.bright,
                    modifier = Modifier.padding(20.dp),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = { password = generator.generate(options) }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Autorenew, contentDescription = null)
                    Text("  Regenerate")
                }
                Button(onClick = {
                    pm.clipboard.copy("Password", password)
                    scope.launch { snackbar.showSnackbar("Copied") }
                }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.ContentCopy, contentDescription = null)
                    Text("  Copy")
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = !options.passphrase, onClick = { update(options.copy(passphrase = false)) }, label = { Text("Random") })
                FilterChip(selected = options.passphrase, onClick = { update(options.copy(passphrase = true)) }, label = { Text("Passphrase") })
            }
            Panel {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    if (options.passphrase) {
                        LabeledSlider("Words", options.words, 3..10) { update(options.copy(words = it)) }
                        Text("Separator", color = Palette.muted, style = MaterialTheme.typography.labelMedium)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("-" to "Hyphen", " " to "Space", "." to "Period", "_" to "Underscore").forEach { (sep, label) ->
                                FilterChip(selected = options.separator == sep, onClick = { update(options.copy(separator = sep)) }, label = { Text(label) })
                            }
                        }
                        Toggle("Capitalize", options.capitalize) { update(options.copy(capitalize = it)) }
                        Toggle("Include a number", options.includeNumber) { update(options.copy(includeNumber = it)) }
                    } else {
                        LabeledSlider("Length", options.length, 8..64) { update(options.copy(length = it)) }
                        Toggle("Uppercase (A-Z)", options.uppercase) { update(options.copy(uppercase = it)) }
                        Toggle("Lowercase (a-z)", options.lowercase) { update(options.copy(lowercase = it)) }
                        Toggle("Digits (0-9)", options.digits) { update(options.copy(digits = it)) }
                        Toggle("Symbols (!@#…)", options.symbols) { update(options.copy(symbols = it)) }
                        Toggle("Avoid look-alikes (l, 1, O, 0)", options.excludeAmbiguous) { update(options.copy(excludeAmbiguous = it)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun LabeledSlider(label: String, value: Int, range: IntRange, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = Palette.fg, modifier = Modifier.weight(1f))
        Text("$value", color = Palette.accent, fontFamily = FontFamily.Monospace)
    }
    Slider(
        value = value.toFloat(),
        onValueChange = { if (it.roundToInt() != value) onChange(it.roundToInt()) },
        valueRange = range.first.toFloat()..range.last.toFloat(),
        steps = range.last - range.first - 1,
    )
}

@Composable
fun Toggle(label: String, checked: Boolean, description: String? = null, onChange: (Boolean) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(vertical = 6.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, color = Palette.fg)
            description?.let { Text(it, color = Palette.muted, style = MaterialTheme.typography.bodySmall) }
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
