@file:OptIn(ExperimentalMaterial3Api::class)

package com.asofianidis.passwordmanager.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.asofianidis.passwordmanager.Biometrics
import com.asofianidis.passwordmanager.Generator
import com.asofianidis.passwordmanager.pm
import com.asofianidis.passwordmanager.vault.EntryInput
import com.asofianidis.passwordmanager.vault.IncorrectPasswordException
import com.asofianidis.passwordmanager.vault.VaultStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

private val barColors @Composable get() = TopAppBarDefaults.topAppBarColors(containerColor = Palette.canvas)

@Composable
fun VaultListScreen(status: VaultStatus) {
    val context = LocalContext.current
    val pm = context.pm
    val nav = LocalNavigator.current
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    val sync by pm.sync.state.collectAsStateWithLifecycle()
    val entries = remember(status.revision) { pm.vault.list().sortedBy { it.title.lowercase() } }
    var query by rememberSaveable { mutableStateOf("") }
    var favorites by rememberSaveable { mutableStateOf(false) }
    var offerBiometric by remember {
        mutableStateOf(!pm.settings.biometricOffered && Biometrics.available(context) && !Biometrics.enabled(context))
    }

    val q = query.trim().lowercase()
    val shown = entries.filter { e ->
        (!favorites || e.favorite) &&
            (q.isEmpty() || e.title.lowercase().contains(q) || e.username.lowercase().contains(q) ||
                e.url.lowercase().contains(q) || e.folder.lowercase().contains(q))
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Vault") },
                colors = barColors,
                actions = {
                    IconButton(enabled = !sync.syncing, onClick = {
                        scope.launch { snackbar.showSnackbar(pm.sync.syncAll()) }
                    }) {
                        if (sync.syncing) {
                            CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                        } else {
                            Icon(Icons.Default.Sync, contentDescription = "Sync now", tint = if (sync.failed) Palette.danger else Palette.fg)
                        }
                    }
                    IconButton(onClick = { pm.vault.lock() }) { Icon(Icons.Default.Lock, contentDescription = "Lock") }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.push(Route(Route.EDIT)) }, containerColor = Palette.accent, contentColor = Palette.accentFg) {
                Icon(Icons.Default.Add, contentDescription = "New login")
            }
        },
    ) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize()) {
            if (status.pendingKeyChange) item { PendingKeyBanner() }
            if (offerBiometric) {
                item {
                    Banner(
                        text = "Unlock with your fingerprint or face instead of typing your master password?",
                        action = "Turn on",
                        onAction = {
                            pm.settings.biometricOffered = true
                            Biometrics.enable(context as androidx.fragment.app.FragmentActivity) { error ->
                                offerBiometric = false
                                if (!error.isNullOrEmpty()) scope.launch { snackbar.showSnackbar(error) }
                            }
                        },
                        onDismiss = {
                            pm.settings.biometricOffered = true
                            offerBiometric = false
                        },
                    )
                }
            }
            item {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("Search ${entries.size} logins") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                )
                Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !favorites, onClick = { favorites = false }, label = { Text("All") })
                    FilterChip(selected = favorites, onClick = { favorites = true }, label = { Text("Favorites") })
                }
            }
            if (shown.isEmpty()) {
                item {
                    Text(
                        when {
                            entries.isEmpty() && pm.settings.peers.value.isNotEmpty() -> "No logins yet. Sync with your computer, or add one with +."
                            entries.isEmpty() -> "No logins yet. Add one with +."
                            else -> "Nothing matches."
                        },
                        color = Palette.muted,
                        modifier = Modifier.padding(24.dp),
                    )
                }
            }
            items(shown, key = { it.id }) { entry ->
                EntryRow(entry, onClick = { nav.push(Route(Route.ENTRY, entry.id)) })
            }
            item { Spacer(Modifier.height(88.dp)) }
        }
    }
}

@Composable
private fun Banner(text: String, action: String, onAction: () -> Unit, onDismiss: (() -> Unit)? = null, color: androidx.compose.ui.graphics.Color = Palette.info) {
    Panel(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(Modifier.padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 4.dp)) {
            Text(text, color = Palette.fg, style = MaterialTheme.typography.bodyMedium)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                if (onDismiss != null) TextButton(onClick = onDismiss) { Text("Not now", color = Palette.muted) }
                TextButton(onClick = onAction) { Text(action, color = color) }
            }
        }
    }
}

/** Another device changed the master password; it has to be entered here to keep syncing. */
@Composable
private fun PendingKeyBanner() {
    val pm = LocalContext.current.pm
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    Banner(
        text = "The master password was changed on another device. Enter the new one to keep syncing.",
        action = "Enter new password",
        onAction = { open = true },
        color = Palette.warn,
    )
    if (open) {
        AlertDialog(
            onDismissRequest = { if (!busy) open = false },
            title = { Text("New master password") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    PasswordField(value = password, onValueChange = { password = it; error = null }, label = "New master password", isError = error != null)
                    error?.let { Text(it, color = Palette.danger) }
                }
            },
            confirmButton = {
                Button(enabled = !busy && password.isNotEmpty(), onClick = {
                    busy = true
                    scope.launch {
                        error = withContext(Dispatchers.Default) {
                            try {
                                pm.vault.adoptPendingKey(password)
                                null
                            } catch (e: IncorrectPasswordException) {
                                "That isn't the new master password"
                            } catch (e: Exception) {
                                e.message
                            }
                        }
                        busy = false
                        if (error == null) {
                            open = false
                            pm.sync.syncSoon(0)
                        }
                    }
                }) { Text(if (busy) "Checking…" else "Switch") }
            },
            dismissButton = {
                TextButton(onClick = {
                    pm.vault.discardPendingKey()
                    open = false
                }) { Text("Ignore change", color = Palette.muted) }
            },
        )
    }
}

@Composable
fun EntryScreen(id: String, status: VaultStatus) {
    val context = LocalContext.current
    val pm = context.pm
    val nav = LocalNavigator.current
    val entry = remember(status.revision) { pm.vault.find(id) }
    var revealed by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var linkedApps by remember { mutableStateOf(pm.settings.appsLinkedTo(id)) }
    if (entry == null) {
        nav.back()
        return
    }

    fun copy(label: String, value: String, sensitive: Boolean) {
        pm.clipboard.copy(label, value, sensitive)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(entry.title, maxLines = 1) },
                colors = barColors,
                navigationIcon = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                actions = {
                    IconButton(onClick = {
                        pm.vault.updateEntry(entry.id, EntryInput.of(entry).copy(favorite = !entry.favorite))
                        pm.sync.syncSoon()
                    }) {
                        Icon(
                            if (entry.favorite) Icons.Default.Star else Icons.Default.StarBorder,
                            contentDescription = if (entry.favorite) "Remove from favorites" else "Add to favorites",
                            tint = if (entry.favorite) Palette.warn else Palette.fg,
                        )
                    }
                    IconButton(onClick = { nav.push(Route(Route.EDIT, entry.id)) }) { Icon(Icons.Default.Edit, contentDescription = "Edit") }
                    IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Default.Delete, contentDescription = "Delete") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Panel {
                DetailRow("Username", entry.username.ifEmpty { null }) {
                    IconButton(onClick = { copy("Username", entry.username, false) }) { Icon(Icons.Default.ContentCopy, contentDescription = "Copy username") }
                }
                HorizontalDivider(color = Palette.line)
                DetailRow("Password", if (entry.password.isEmpty()) null else if (revealed) entry.password else "••••••••••••", mono = revealed) {
                    if (entry.password.isNotEmpty()) {
                        IconButton(onClick = { revealed = !revealed }) {
                            Icon(if (revealed) Icons.Default.VisibilityOff else Icons.Default.Visibility, contentDescription = if (revealed) "Hide" else "Show")
                        }
                        IconButton(onClick = { copy("Password", entry.password, true) }) { Icon(Icons.Default.ContentCopy, contentDescription = "Copy password") }
                    }
                }
                HorizontalDivider(color = Palette.line)
                val web = entry.url.startsWith("http://") || entry.url.startsWith("https://") || (entry.url.isNotBlank() && !entry.url.contains("://"))
                DetailRow("Website", entry.url.ifBlank { null }?.let(::displayUrl)) {
                    if (web) {
                        IconButton(onClick = {
                            val url = if (entry.url.contains("://")) entry.url else "https://${entry.url}"
                            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                        }) { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = "Open website") }
                    }
                }
                if (entry.folder.isNotBlank()) {
                    HorizontalDivider(color = Palette.line)
                    DetailRow("Folder", entry.folder)
                }
                if (entry.totp.isNotBlank()) {
                    HorizontalDivider(color = Palette.line)
                    DetailRow("Two-factor", "Secret stored")
                }
            }
            if (entry.notes.isNotBlank()) {
                Panel {
                    Column(Modifier.padding(16.dp)) {
                        Text("Notes", color = Palette.muted, style = MaterialTheme.typography.labelMedium)
                        Spacer(Modifier.height(4.dp))
                        Text(entry.notes, color = Palette.fg)
                    }
                }
            }
            if (linkedApps.isNotEmpty()) {
                Panel {
                    Column(Modifier.padding(vertical = 8.dp)) {
                        Text("Also offered in these apps", color = Palette.muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 16.dp))
                        linkedApps.forEach { pkg ->
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 16.dp)) {
                                Text(appLabel(context, pkg), color = Palette.fg, modifier = Modifier.weight(1f))
                                TextButton(onClick = {
                                    pm.settings.unlinkApp(pkg, entry.id)
                                    linkedApps = pm.settings.appsLinkedTo(entry.id)
                                }) { Text("Remove", color = Palette.danger) }
                            }
                        }
                    }
                }
            }
            val format = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
            Text(
                "Modified ${format.format(Date(entry.updatedAt))} · Password changed ${format.format(Date(entry.passwordUpdatedAt))}",
                color = Palette.faint,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete ${entry.title}?") },
            text = { Text("It will also be removed from your synced devices.") },
            confirmButton = {
                Button(onClick = {
                    pm.vault.deleteEntry(entry.id)
                    pm.sync.syncSoon()
                    confirmDelete = false
                    nav.back()
                }, colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = Palette.danger)) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}

fun appLabel(context: android.content.Context, packageName: String): String = runCatching {
    val pmgr = context.packageManager
    pmgr.getApplicationLabel(pmgr.getApplicationInfo(packageName, 0)).toString()
}.getOrDefault(packageName)

@Composable
private fun DetailRow(label: String, value: String?, mono: Boolean = false, actions: @Composable () -> Unit = {}) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp)) {
        Column(Modifier.weight(1f)) {
            Text(label, color = Palette.muted, style = MaterialTheme.typography.labelMedium)
            Text(
                value ?: "—",
                color = if (value == null) Palette.faint else Palette.bright,
                fontFamily = if (mono) FontFamily.Monospace else null,
            )
        }
        actions()
    }
}

@Composable
fun EditScreen(id: String?) {
    val context = LocalContext.current
    val pm = context.pm
    val nav = LocalNavigator.current
    val existing = remember { id?.let { pm.vault.find(it) } }
    val generator = remember { Generator(context) }
    var title by rememberSaveable { mutableStateOf(existing?.title ?: "") }
    var username by rememberSaveable { mutableStateOf(existing?.username ?: "") }
    var password by rememberSaveable { mutableStateOf(existing?.password ?: "") }
    var url by rememberSaveable { mutableStateOf(existing?.url ?: "") }
    var folder by rememberSaveable { mutableStateOf(existing?.folder ?: "") }
    var notes by rememberSaveable { mutableStateOf(existing?.notes ?: "") }
    var totp by rememberSaveable { mutableStateOf(existing?.totp ?: "") }
    var favorite by rememberSaveable { mutableStateOf(existing?.favorite ?: false) }

    fun save() {
        val input = EntryInput(title, username, password, url, notes, totp, folder, favorite)
        val saved = if (existing != null) pm.vault.updateEntry(existing.id, input) else pm.vault.createEntry(input)
        pm.sync.syncSoon()
        if (existing != null) nav.back() else nav.replace(Route(Route.ENTRY, saved.id))
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (existing != null) "Edit login" else "New login") },
                colors = barColors,
                navigationIcon = { IconButton(onClick = nav::back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Cancel") } },
                actions = { TextButton(onClick = ::save) { Text("Save", color = Palette.accent) } },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val words = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Next)
            val plain = KeyboardOptions(autoCorrectEnabled = false, imeAction = ImeAction.Next)
            OutlinedTextField(title, { title = it }, label = { Text("Title") }, singleLine = true, keyboardOptions = words, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(username, { username = it }, label = { Text("Username or email") }, singleLine = true,
                keyboardOptions = plain.copy(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically) {
                PasswordField(password, { password = it }, "Password", modifier = Modifier.weight(1f), imeAction = ImeAction.Next)
                IconButton(onClick = { password = generator.generate(pm.settings.generator) }) {
                    Icon(Icons.Default.Autorenew, contentDescription = "Generate password", tint = Palette.accent)
                }
            }
            OutlinedTextField(url, { url = it }, label = { Text("Website") }, placeholder = { Text("example.com") }, singleLine = true,
                keyboardOptions = plain.copy(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(folder, { folder = it }, label = { Text("Folder") }, singleLine = true, keyboardOptions = words, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(totp, { totp = it }, label = { Text("Two-factor secret") }, placeholder = { Text("otpauth://… or base32") }, singleLine = true,
                keyboardOptions = plain, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(notes, { notes = it }, label = { Text("Notes") }, minLines = 3, modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable { favorite = !favorite }) {
                Text("Favorite", color = Palette.fg, modifier = Modifier.weight(1f))
                Switch(checked = favorite, onCheckedChange = { favorite = it })
            }
            Spacer(Modifier.width(1.dp))
        }
    }
}
