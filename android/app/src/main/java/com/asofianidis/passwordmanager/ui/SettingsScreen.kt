@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.asofianidis.passwordmanager.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.view.autofill.AutofillManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.asofianidis.passwordmanager.Biometrics
import com.asofianidis.passwordmanager.SyncManager
import com.asofianidis.passwordmanager.SyncPeer
import com.asofianidis.passwordmanager.pm
import com.asofianidis.passwordmanager.sync.DEFAULT_SYNC_PORT
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date
import java.util.UUID

@Composable
fun SettingsScreen() {
    val context = LocalContext.current
    val pm = context.pm
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    // Re-read settings whenever one changes
    val revision by pm.settings.revision.collectAsStateWithLifecycle()
    val peers by pm.settings.peers.collectAsStateWithLifecycle()
    val sync by pm.sync.state.collectAsStateWithLifecycle()
    var autofillOn by remember { mutableStateOf(false) }
    var addingPeer by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf(false) }
    LifecycleResumeEffect(Unit) {
        autofillOn = context.getSystemService(AutofillManager::class.java)?.hasEnabledAutofillServices() == true
        onPauseOrDispose {}
    }
    @Suppress("UNUSED_EXPRESSION") revision

    Scaffold(topBar = { TopAppBar(title = { Text("Settings") }, colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.canvas)) }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            SectionLabel("Autofill", Modifier.padding(start = 0.dp))
            Panel {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            if (autofillOn) Icons.Default.CheckCircle else Icons.Default.ErrorOutline,
                            contentDescription = null,
                            tint = if (autofillOn) Palette.ok else Palette.warn,
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            if (autofillOn) "Password Manager fills logins in apps and browsers" else "Autofill is off",
                            color = Palette.bright,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    if (!autofillOn) {
                        Text("Choose Password Manager as your autofill service to fill logins in apps and browsers.", color = Palette.muted, style = MaterialTheme.typography.bodySmall)
                        Button(onClick = {
                            val intent = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE, Uri.parse("package:${context.packageName}"))
                            runCatching { context.startActivity(intent) }.onFailure {
                                runCatching { context.startActivity(Intent(Settings.ACTION_SETTINGS)) }
                            }
                        }) { Text("Turn on autofill") }
                    }
                    HorizontalDivider(color = Palette.line)
                    Text("Chrome", color = Palette.fg)
                    Text(
                        "In Chrome, open Settings → Autofill services and choose “Autofill using another service”, then restart Chrome. " +
                            "Firefox, Brave, Edge, and Samsung Internet use your autofill service without extra steps.",
                        color = Palette.muted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Text(
                        "On Android 11 and later, keyboards like Gboard show your logins in their suggestion strip.",
                        color = Palette.muted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            SectionLabel("Unlock", Modifier.padding(start = 0.dp))
            Panel {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    if (Biometrics.available(context)) {
                        Toggle("Biometric unlock", Biometrics.enabled(context), "Fingerprint or face instead of your master password") { on ->
                            if (on) {
                                Biometrics.enable(context as FragmentActivity) { error ->
                                    pm.settings.biometricOffered = true
                                    if (!error.isNullOrEmpty()) scope.launch { snackbar.showSnackbar(error) }
                                }
                            } else {
                                Biometrics.disable(context)
                            }
                        }
                    }
                    Text("Lock after", color = Palette.fg, modifier = Modifier.padding(top = 6.dp))
                    Choices(
                        listOf(1 to "1 min", 5 to "5 min", 15 to "15 min", 60 to "1 hour", 0 to "Never"),
                        pm.settings.autoLockMinutes,
                    ) {
                        pm.settings.autoLockMinutes = it
                        pm.autoLock.touch()
                    }
                    Toggle("Lock when the screen turns off", pm.settings.lockOnScreenOff) { pm.settings.lockOnScreenOff = it }
                    Toggle("Block screenshots", pm.settings.blockScreenshots, "Also hides the vault in recent apps") { pm.settings.blockScreenshots = it }
                    Text("Clear copied passwords after", color = Palette.fg, modifier = Modifier.padding(top = 6.dp))
                    Choices(
                        listOf(15 to "15 s", 30 to "30 s", 60 to "1 min", 0 to "Never"),
                        pm.settings.clipboardClearSeconds,
                    ) { pm.settings.clipboardClearSeconds = it }
                }
            }

            SectionLabel("Sync", Modifier.padding(start = 0.dp))
            Panel {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    var name by remember { mutableStateOf(pm.settings.deviceName) }
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it; pm.settings.deviceName = it },
                        label = { Text("This phone's name") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (peers.isEmpty()) Text("No computers yet.", color = Palette.muted)
                    peers.forEach { peer -> PeerRow(peer) }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Button(enabled = !sync.syncing && peers.isNotEmpty(), onClick = {
                            scope.launch { snackbar.showSnackbar(pm.sync.syncAll()) }
                        }) { Text(if (sync.syncing) "Syncing…" else "Sync now") }
                        OutlinedButton(onClick = { addingPeer = true }) { Text("Add computer") }
                    }
                    Text(
                        "This phone syncs with your computers when you unlock it and after each change. They need Accept sync connections turned on and the vault unlocked.",
                        color = Palette.muted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            SectionLabel("Vault", Modifier.padding(start = 0.dp))
            Panel {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "To change your master password, use Password Manager on your computer. This phone switches over on its next sync.",
                        color = Palette.muted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedButton(onClick = { pm.vault.lock() }) { Text("Lock now") }
                        OutlinedButton(onClick = { confirmRemove = true }) { Text("Remove from phone", color = Palette.danger) }
                    }
                }
            }

            SectionLabel("Updates", Modifier.padding(start = 0.dp))
            UpdatesPanel()
            Spacer(Modifier.height(24.dp))
        }
    }

    if (addingPeer) AddPeerDialog(onClose = { addingPeer = false })
    if (confirmRemove) {
        AlertDialog(
            onDismissRequest = { confirmRemove = false },
            title = { Text("Remove the vault from this phone?") },
            text = { Text("Your logins stay on your computer and other devices. Changes made here that haven't synced yet are lost. You can pair again later.") },
            confirmButton = {
                Button(onClick = {
                    Biometrics.disable(context)
                    pm.vault.erase()
                    pm.settings.clearVaultState()
                }, colors = ButtonDefaults.buttonColors(containerColor = Palette.danger)) { Text("Remove") }
            },
            dismissButton = { TextButton(onClick = { confirmRemove = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun Choices(options: List<Pair<Int, String>>, selected: Int, onSelect: (Int) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (value, label) ->
            FilterChip(selected = selected == value, onClick = { onSelect(value) }, label = { Text(label) })
        }
    }
}

@Composable
private fun PeerRow(peer: SyncPeer) {
    val pm = LocalContext.current.pm
    var confirm by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(peer.name, color = Palette.bright)
            Text("${peer.host}:${peer.port}", color = Palette.muted, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
            when {
                peer.lastError != null -> Text(peer.lastError, color = Palette.danger, style = MaterialTheme.typography.bodySmall)
                peer.lastSyncAt != null -> Text(
                    "Synced ${DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(peer.lastSyncAt))}",
                    color = Palette.ok,
                    style = MaterialTheme.typography.bodySmall,
                )
                else -> Text("Not synced yet", color = Palette.muted, style = MaterialTheme.typography.bodySmall)
            }
        }
        TextButton(onClick = { confirm = true }) { Text("Remove", color = Palette.muted) }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Stop syncing with ${peer.name}?") },
            text = { Text("Your logins stay on both devices.") },
            confirmButton = {
                Button(onClick = {
                    pm.settings.setPeers { peers -> peers.filter { it.id != peer.id } }
                    confirm = false
                }) { Text("Stop syncing") }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
}

/** Adds another computer that already has this vault (no pairing needed: it holds the same key). */
@Composable
private fun AddPeerDialog(onClose: () -> Unit) {
    val pm = LocalContext.current.pm
    val scope = rememberCoroutineScope()
    var host by remember { mutableStateOf("") }
    var port by remember { mutableStateOf(DEFAULT_SYNC_PORT.toString()) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        title = { Text("Add a computer") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("A computer that already has this vault. To set up a new one, pair it from a computer that has it.", color = Palette.muted, style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(host, { host = it.trim() }, label = { Text("Address") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false))
                OutlinedTextField(port, { port = it.filter(Char::isDigit).take(5) }, label = { Text("Port") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                error?.let { Text(it, color = Palette.danger, style = MaterialTheme.typography.bodySmall) }
                Spacer(Modifier.height(2.dp))
            }
        },
        confirmButton = {
            Button(enabled = !busy && host.isNotBlank() && port.toIntOrNull() in 1..65535, onClick = {
                busy = true
                error = null
                scope.launch {
                    try {
                        val p = port.toInt()
                        val hello = withContext(Dispatchers.IO) { pm.sync.client.hello(host, p) }
                        when {
                            hello.app != "pm" -> error = "That isn't Password Manager"
                            hello.vaultId != pm.vault.vaultId -> error = "${hello.deviceName} has a different vault"
                            else -> {
                                pm.settings.setPeers { peers ->
                                    peers.filter { it.host != host || it.port != p } + SyncPeer(UUID.randomUUID().toString(), hello.deviceName, host, p)
                                }
                                pm.sync.syncSoon(0)
                                onClose()
                            }
                        }
                    } catch (e: Exception) {
                        error = SyncManager.describe(e)
                    } finally {
                        busy = false
                    }
                }
            }) { Text(if (busy) "Checking…" else "Add") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } },
    )
}
