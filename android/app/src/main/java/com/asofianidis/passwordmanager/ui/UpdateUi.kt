package com.asofianidis.passwordmanager.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.asofianidis.passwordmanager.pm
import com.asofianidis.passwordmanager.update.UpdateInfo
import com.asofianidis.passwordmanager.update.UpdateState
import com.asofianidis.passwordmanager.update.UpdateWorker
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/** Starts installing [info], first sending the user to allow installs if needed. */
private fun startUpdate(context: Context, info: UpdateInfo) {
    val pm = context.pm
    if (!pm.updater.canInstall) {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
        runCatching { context.startActivity(intent) }
        return
    }
    pm.scope.launch { runCatching { pm.updater.install(info, interactive = true) } }
}

private fun progressText(state: UpdateState) = when {
    state.installing -> "Installing…"
    state.progress != null -> "Downloading… ${(state.progress * 100).toInt()}%"
    else -> null
}

/** Shown above the vault list while a newer version is available. */
@Composable
fun UpdateBanner() {
    val context = LocalContext.current
    val pm = context.pm
    val state by pm.updater.state.collectAsStateWithLifecycle()
    var hidden by remember { mutableStateOf<String?>(null) }
    val info = state.available ?: return
    if (!pm.updater.supported || hidden == info.version) return
    Panel(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(Modifier.padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 4.dp)) {
            Text("Version ${info.version} is available.", color = Palette.fg, style = MaterialTheme.typography.bodyMedium)
            state.error?.let { Text(it, color = Palette.danger, style = MaterialTheme.typography.bodySmall) }
            val progress = progressText(state)
            if (progress != null) {
                Text(progress, color = Palette.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
                LinearProgressIndicator(progress = { state.progress ?: 1f }, modifier = Modifier.fillMaxWidth().padding(end = 8.dp, top = 6.dp, bottom = 10.dp))
            } else {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { hidden = info.version }) { Text("Not now", color = Palette.muted) }
                    TextButton(onClick = { startUpdate(context, info) }) { Text("Update", color = Palette.info) }
                }
            }
        }
    }
}

@Composable
fun UpdatesPanel() {
    val context = LocalContext.current
    val pm = context.pm
    val state by pm.updater.state.collectAsStateWithLifecycle()
    // Re-read the toggles when a setting changes
    val revision by pm.settings.revision.collectAsStateWithLifecycle()
    @Suppress("UNUSED_EXPRESSION") revision
    val scope = rememberCoroutineScope()
    val version = remember { context.packageManager.getPackageInfo(context.packageName, 0).versionName }
    var canInstall by remember { mutableStateOf(pm.updater.canInstall) }
    var canNotify by remember { mutableStateOf(notificationsAllowed(context)) }
    LifecycleResumeEffect(Unit) {
        canInstall = pm.updater.canInstall
        canNotify = notificationsAllowed(context)
        onPauseOrDispose {}
    }
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { canNotify = it }

    Panel {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Version $version", color = Palette.bright)
            if (!pm.updater.supported) {
                Text("This is a development build, so it doesn't update itself.", color = Palette.muted, style = MaterialTheme.typography.bodySmall)
                return@Column
            }
            val info = state.available
            val status = progressText(state) ?: when {
                state.checking -> "Checking…"
                info != null -> "Version ${info.version} is available"
                state.checkedAt != null -> "Up to date · checked ${DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(state.checkedAt!!))}"
                else -> "Not checked yet"
            }
            Text(status, color = if (info != null) Palette.ok else Palette.muted, style = MaterialTheme.typography.bodySmall)
            state.error?.let { Text(it, color = Palette.danger, style = MaterialTheme.typography.bodySmall) }
            if (state.progress != null) LinearProgressIndicator(progress = { state.progress ?: 0f }, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (info != null) {
                    Button(enabled = !state.busy, onClick = { startUpdate(context, info) }) {
                        Text(if (canInstall) "Install ${info.version}" else "Allow installs")
                    }
                }
                OutlinedButton(enabled = !state.busy, onClick = { scope.launch { runCatching { pm.updater.check() } } }) { Text("Check now") }
            }
            if (info != null && !canInstall) {
                Text(
                    "Android asks you to let Password Manager install apps. It only installs its own updates.",
                    color = Palette.muted,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Toggle("Check for updates", pm.settings.updateChecks, "Every few hours, from GitHub releases") {
                pm.settings.updateChecks = it
                UpdateWorker.schedule(context)
            }
            if (pm.settings.updateChecks) {
                Toggle(
                    "Install updates automatically",
                    pm.settings.updateInstall,
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        "While the app is closed and the vault is locked"
                    } else {
                        "Android asks you to confirm each update"
                    },
                ) { pm.settings.updateInstall = it }
                if (!canNotify && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    TextButton(onClick = { askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS) }) {
                        Text("Notify me about updates")
                    }
                }
            }
        }
    }
}

private fun notificationsAllowed(context: Context) =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
