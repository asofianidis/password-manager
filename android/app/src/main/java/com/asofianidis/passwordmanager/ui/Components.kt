package com.asofianidis.passwordmanager.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.StickyNote2
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import com.asofianidis.passwordmanager.Biometrics
import com.asofianidis.passwordmanager.pm
import com.asofianidis.passwordmanager.vault.EntryType
import com.asofianidis.passwordmanager.vault.IncorrectPasswordException
import com.asofianidis.passwordmanager.vault.VaultEntry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun PasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    imeAction: ImeAction = ImeAction.Done,
    onDone: () -> Unit = {},
    isError: Boolean = false,
) {
    var visible by rememberSaveable { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = true,
        isError = isError,
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = imeAction, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onDone = { onDone() }, onGo = { onDone() }),
        trailingIcon = {
            IconButton(onClick = { visible = !visible }) {
                Icon(
                    if (visible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                    contentDescription = if (visible) "Hide password" else "Show password",
                )
            }
        },
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * Master password and biometric unlock. Used by the app and by autofill, which may need to unlock
 * before it can fill.
 */
@Composable
fun UnlockPanel(onUnlocked: () -> Unit, autoBiometric: Boolean = true) {
    val context = LocalContext.current
    val activity = context as FragmentActivity
    val pm = context.pm
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(pm.settings.notice) }
    var busy by remember { mutableStateOf(false) }
    val canBiometric = remember { Biometrics.canUnlock(context) }
    val focus = remember { FocusRequester() }

    fun biometric() {
        Biometrics.unlock(activity) { result ->
            if (result == null) {
                onUnlocked()
            } else if (result.isNotEmpty()) {
                error = result
            }
        }
    }

    fun submit() {
        if (password.isEmpty() || busy) return
        busy = true
        error = null
        scope.launch {
            val failure = withContext(Dispatchers.Default) {
                try {
                    pm.vault.unlock(password)
                    null
                } catch (e: IncorrectPasswordException) {
                    "Incorrect master password"
                } catch (e: Exception) {
                    e.message ?: "Couldn't unlock"
                }
            }
            busy = false
            if (failure == null) {
                password = ""
                pm.settings.notice = null
                onUnlocked()
            } else {
                error = failure
            }
        }
    }

    LaunchedEffect(Unit) {
        if (canBiometric && autoBiometric) biometric() else runCatching { focus.requestFocus() }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        PasswordField(
            value = password,
            onValueChange = { password = it; error = null },
            label = "Master password",
            imeAction = ImeAction.Go,
            onDone = ::submit,
            isError = error != null,
            modifier = Modifier.focusRequester(focus),
        )
        error?.let { Text(it, color = if (it == pm.settings.notice) Palette.warn else Palette.danger, style = MaterialTheme.typography.bodySmall) }
        Button(onClick = ::submit, enabled = !busy && password.isNotEmpty(), modifier = Modifier.fillMaxWidth().height(48.dp)) {
            if (busy) {
                CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp), color = Palette.accentFg)
            } else {
                Text("Unlock")
            }
        }
        if (canBiometric) {
            OutlinedButton(onClick = ::biometric, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                Icon(Icons.Default.Fingerprint, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Use biometric unlock")
            }
        }
    }
}

/** A rounded letter tile standing in for a site icon. */
@Composable
fun Monogram(text: String, modifier: Modifier = Modifier) {
    val letter = text.trim().firstOrNull { it.isLetterOrDigit() }?.uppercaseChar()?.toString() ?: "•"
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(40.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Palette.raised)
            .border(1.dp, Palette.lineStrong, RoundedCornerShape(10.dp)),
    ) {
        Text(letter, color = Palette.accent, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
    }
}

@Composable
fun EntryRow(entry: VaultEntry, onClick: () -> Unit, trailing: @Composable (() -> Unit)? = null) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        if (entry.isLogin) Monogram(entry.title.ifBlank { entry.url }) else TypeTile(entry.entryType)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    entry.title.ifBlank { "Untitled" },
                    color = Palette.bright,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (entry.favorite) {
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.Default.Star, contentDescription = "Favorite", tint = Palette.warn, modifier = Modifier.size(14.dp))
                }
            }
            val subtitle = if (entry.isLogin) entry.username.ifBlank { displayUrl(entry.url) } else entry.detail
            if (subtitle.isNotBlank()) {
                Text(subtitle, color = Palette.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        trailing?.invoke()
    }
}

/** A tile with the entry type's icon, in place of a monogram for non-logins. */
@Composable
fun TypeTile(type: EntryType, modifier: Modifier = Modifier) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(40.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Palette.raised)
            .border(1.dp, Palette.lineStrong, RoundedCornerShape(10.dp)),
    ) {
        Icon(typeIcon(type), contentDescription = type.one, tint = Palette.accent, modifier = Modifier.size(20.dp))
    }
}

fun typeIcon(type: EntryType): androidx.compose.ui.graphics.vector.ImageVector = when (type) {
    EntryType.LOGIN -> Icons.Default.Key
    EntryType.CARD -> Icons.Default.CreditCard
    EntryType.IDENTITY -> Icons.Default.Badge
    EntryType.NOTE -> Icons.AutoMirrored.Filled.StickyNote2
    EntryType.DOCUMENT -> Icons.Default.Description
}

fun displayUrl(url: String): String =
    url.trim().removePrefix("https://").removePrefix("http://").removePrefix("www.").trimEnd('/')

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        color = Palette.muted,
        style = MaterialTheme.typography.labelSmall,
        letterSpacing = 1.sp,
        modifier = modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 6.dp),
    )
}

/** A bordered card, like the desktop's panels. */
@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Palette.panel)
            .border(1.dp, Palette.line, RoundedCornerShape(14.dp)),
    ) { content() }
}

@Composable
fun Mono(text: String, modifier: Modifier = Modifier) {
    Text(text, fontFamily = FontFamily.Monospace, color = Palette.bright, modifier = modifier)
}
