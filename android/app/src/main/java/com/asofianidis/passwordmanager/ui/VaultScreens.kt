@file:OptIn(ExperimentalMaterial3Api::class)

package com.asofianidis.passwordmanager.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
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
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.asofianidis.passwordmanager.Biometrics
import com.asofianidis.passwordmanager.pm
import com.asofianidis.passwordmanager.vault.EntryType
import com.asofianidis.passwordmanager.vault.IncorrectPasswordException
import com.asofianidis.passwordmanager.vault.VaultStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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
    /** null shows every type */
    var typeFilter by rememberSaveable { mutableStateOf<String?>(null) }
    var choosingType by remember { mutableStateOf(false) }
    val filterType = typeFilter?.let { EntryType.valueOf(it) }
    var offerBiometric by remember {
        mutableStateOf(!pm.settings.biometricOffered && Biometrics.available(context) && !Biometrics.enabled(context))
    }

    val q = query.trim().lowercase()
    val shown = entries.filter { e ->
        (!favorites || e.favorite) && (filterType == null || e.entryType == filterType) &&
            (q.isEmpty() || e.title.lowercase().contains(q) || e.username.lowercase().contains(q) ||
                e.url.lowercase().contains(q) || e.folder.lowercase().contains(q) || e.detail.lowercase().contains(q))
    }
    val noun = filterType?.many?.lowercase() ?: "items"

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
            Box {
                FloatingActionButton(
                    onClick = { if (filterType != null) nav.push(Route(Route.NEW, filterType.name)) else choosingType = true },
                    containerColor = Palette.accent,
                    contentColor = Palette.accentFg,
                ) {
                    Icon(Icons.Default.Add, contentDescription = "New ${filterType?.one?.lowercase() ?: "item"}")
                }
                DropdownMenu(expanded = choosingType, onDismissRequest = { choosingType = false }) {
                    EntryType.entries.forEach { type ->
                        DropdownMenuItem(
                            text = { Text(type.one) },
                            leadingIcon = { Icon(typeIcon(type), contentDescription = null) },
                            onClick = {
                                choosingType = false
                                nav.push(Route(Route.NEW, type.name))
                            },
                        )
                    }
                }
            }
        },
    ) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize()) {
            if (status.pendingKeyChange) item { PendingKeyBanner() }
            item { UpdateBanner() }
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
                    placeholder = { Text("Search ${entries.size} items") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                )
                Row(
                    Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FilterChip(selected = !favorites && filterType == null, onClick = {
                        favorites = false
                        typeFilter = null
                    }, label = { Text("All") })
                    FilterChip(selected = favorites, onClick = { favorites = !favorites }, label = { Text("Favorites") })
                    EntryType.entries.forEach { type ->
                        FilterChip(
                            selected = filterType == type,
                            onClick = { typeFilter = if (filterType == type) null else type.name },
                            label = { Text(type.many) },
                        )
                    }
                }
            }
            if (shown.isEmpty()) {
                item {
                    Text(
                        when {
                            entries.isEmpty() && pm.settings.peers.value.isNotEmpty() -> "Nothing saved yet. Sync with your computer, or add something with +."
                            entries.isEmpty() -> "Nothing saved yet. Add something with +."
                            q.isEmpty() && !favorites -> "No $noun yet. Add one with +."
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

fun appLabel(context: android.content.Context, packageName: String): String = runCatching {
    val pmgr = context.packageManager
    pmgr.getApplicationLabel(pmgr.getApplicationInfo(packageName, 0)).toString()
}.getOrDefault(packageName)
