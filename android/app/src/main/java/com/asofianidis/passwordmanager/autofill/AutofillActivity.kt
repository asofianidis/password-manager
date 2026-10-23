package com.asofianidis.passwordmanager.autofill

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Context
import android.content.Intent
import android.content.IntentSender
import android.os.Build
import android.os.Bundle
import android.service.autofill.Dataset
import android.view.View
import android.view.WindowManager
import android.view.autofill.AutofillManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.IntentCompat
import androidx.fragment.app.FragmentActivity
import com.asofianidis.passwordmanager.match.UrlMatch
import com.asofianidis.passwordmanager.pm
import com.asofianidis.passwordmanager.ui.EntryRow
import com.asofianidis.passwordmanager.ui.Palette
import com.asofianidis.passwordmanager.ui.PasswordField
import com.asofianidis.passwordmanager.ui.PmTheme
import com.asofianidis.passwordmanager.ui.SectionLabel
import com.asofianidis.passwordmanager.ui.UnlockPanel
import com.asofianidis.passwordmanager.ui.displayUrl
import com.asofianidis.passwordmanager.vault.EntryInput
import com.asofianidis.passwordmanager.vault.VaultEntry
import com.asofianidis.passwordmanager.vault.VaultState

/**
 * Opened by autofill: unlocks the vault if needed, lets the user pick a login to fill, or saves a
 * login they typed.
 */
class AutofillActivity : FragmentActivity() {
    private var form: LoginForm? = null
    private var saveToken: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (pm.settings.blockScreenshots) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        // Keep autofill services (including other password managers) away from the master password
        window.decorView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        enableEdgeToEdge()
        val mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_PICK
        if (mode == MODE_SAVE) {
            saveToken = intent.getStringExtra(EXTRA_TOKEN)
            val pending = PendingSave.get(saveToken) ?: return finish()
            setContent { PmTheme { Sheet { Gate { SaveScreen(pending) } } } }
        } else {
            val structure = IntentCompat.getParcelableExtra(intent, AutofillManager.EXTRA_ASSIST_STRUCTURE, AssistStructure::class.java)
                ?: return finish()
            val parsed = FormParser.parse(structure).also { form = it }
            setContent { PmTheme { Sheet { Gate(onUnlocked = { autoFill(parsed, mode) }) { PickScreen(parsed) } } } }
        }
    }

    override fun onResume() {
        super.onResume()
        pm.autoLock.checkExpired()
    }

    override fun onUserInteraction() {
        super.onUserInteraction()
        pm.autoLock.touch()
    }

    override fun finish() {
        if (isFinishing) return
        PendingSave.remove(saveToken)
        super.finish()
    }

    /** After unlocking from "Unlock to fill", fill straight away when exactly one login matches. */
    private fun autoFill(form: LoginForm, mode: String) {
        if (mode != MODE_UNLOCK) return
        Responses.matches(this, form).singleOrNull()?.let { fill(form, it) }
    }

    private fun fill(form: LoginForm, entry: VaultEntry) {
        val dataset: Dataset = Responses.dataset(this, form, entry)
        setResult(RESULT_OK, Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset))
        pm.autoLock.touch()
        finish()
    }

    private fun appLabel(packageName: String): String = runCatching {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(packageName, 0)).toString()
    }.getOrDefault(packageName)

    /** A card at the bottom of the screen over the app being filled. */
    @Composable
    private fun Sheet(content: @Composable () -> Unit) {
        Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding(), verticalArrangement = Arrangement.Bottom) {
            Surface(
                color = Palette.canvas,
                shape = MaterialTheme.shapes.extraLarge,
                tonalElevation = 0.dp,
                modifier = Modifier.fillMaxWidth().padding(8.dp),
            ) {
                Column(Modifier.padding(vertical = 8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 20.dp, end = 4.dp)) {
                        Text("Password Manager", style = MaterialTheme.typography.titleMedium, color = Palette.bright, modifier = Modifier.weight(1f))
                        IconButton(onClick = { setResult(RESULT_CANCELED); finish() }) {
                            Icon(Icons.Default.Close, contentDescription = "Close")
                        }
                    }
                    content()
                }
            }
        }
    }

    /** Shows the unlock panel until the vault is open. */
    @Composable
    private fun Gate(onUnlocked: () -> Unit = {}, content: @Composable () -> Unit) {
        var unlocked by remember { mutableStateOf(pm.vault.status.value.state == VaultState.UNLOCKED) }
        if (pm.vault.status.value.state == VaultState.NO_VAULT) {
            Text("Set up Password Manager first.", modifier = Modifier.padding(20.dp))
            return
        }
        if (unlocked) {
            content()
        } else {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                UnlockPanel(onUnlocked = {
                    unlocked = true
                    onUnlocked()
                })
            }
        }
    }

    @Composable
    private fun PickScreen(form: LoginForm) {
        val all = remember { pm.vault.logins().sortedBy { it.title.lowercase() } }
        val matches = remember { Responses.matches(this, form) }
        val suggested = remember {
            if (form.pageUrl == null) UrlMatch.suggestionsForApp(all, form.packageName) - matches.toSet() else emptyList()
        }
        val origin = remember { if (form.pageUrl != null) form.displayOrigin else appLabel(form.packageName) }
        var query by rememberSaveable { mutableStateOf("") }
        var confirm by remember { mutableStateOf<VaultEntry?>(null) }

        fun choose(entry: VaultEntry) {
            if (entry in matches) fill(form, entry) else confirm = entry
        }

        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Search logins") },
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        val q = query.trim().lowercase()
        val results = if (q.isEmpty()) emptyList() else all.filter {
            it.title.lowercase().contains(q) || it.username.lowercase().contains(q) || it.url.lowercase().contains(q)
        }
        LazyColumn(Modifier.fillMaxWidth().height(380.dp)) {
            if (q.isNotEmpty()) {
                if (results.isEmpty()) item { Text("No logins found", color = Palette.muted, modifier = Modifier.padding(20.dp)) }
                items(results, key = { "r" + it.id }) { EntryRow(it, onClick = { choose(it) }) }
            } else {
                item { SectionLabel("For $origin") }
                if (matches.isEmpty()) {
                    item { Text("No saved logins yet. Pick one below to use it here.", color = Palette.muted, modifier = Modifier.padding(horizontal = 16.dp)) }
                }
                items(matches, key = { "m" + it.id }) { EntryRow(it, onClick = { choose(it) }) }
                if (suggested.isNotEmpty()) {
                    item { SectionLabel("Suggested") }
                    items(suggested, key = { "s" + it.id }) { EntryRow(it, onClick = { choose(it) }) }
                }
                item { SectionLabel("All logins") }
                items(all, key = { "a" + it.id }) { EntryRow(it, onClick = { choose(it) }) }
            }
        }

        confirm?.let { entry ->
            var alwaysOffer by remember { mutableStateOf(true) }
            val isApp = form.pageUrl == null
            AlertDialog(
                onDismissRequest = { confirm = null },
                title = { Text("Fill this login?") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        val saved = displayUrl(entry.url).ifBlank { "no website" }
                        Text("“${entry.title}” is saved for $saved, but you're filling $origin. Only continue if you trust it.")
                        if (isApp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(checked = alwaysOffer, onCheckedChange = { alwaysOffer = it })
                                Text("Always offer this login in $origin")
                            }
                        }
                    }
                },
                confirmButton = {
                    Button(onClick = {
                        if (isApp && alwaysOffer) pm.settings.linkApp(form.packageName, entry.id)
                        fill(form, entry)
                    }) { Text("Fill") }
                },
                dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } },
            )
        }
    }

    @Composable
    private fun SaveScreen(save: PendingSave) {
        val origin = remember { save.pageUrl?.substringAfter("://") ?: appLabel(save.packageName) }
        val existing = remember {
            val entries = pm.vault.logins()
            val candidates = if (save.pageUrl != null) UrlMatch.forPage(entries, save.pageUrl)
            else UrlMatch.forApp(entries, save.packageName, pm.settings.linkedEntries(save.packageName))
            candidates.firstOrNull { it.username == save.username }
        }
        if (existing != null && existing.password == save.password) {
            // Nothing new to save
            Text("This login is already saved.", modifier = Modifier.padding(20.dp))
            Button(onClick = { finish() }, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp).fillMaxWidth()) { Text("Done") }
            return
        }
        var title by rememberSaveable { mutableStateOf(existing?.title ?: origin.removePrefix("www.")) }
        var username by rememberSaveable { mutableStateOf(save.username) }
        var password by rememberSaveable { mutableStateOf(save.password) }
        Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                if (existing != null) "Update the saved password for ${existing.title}?" else "Save this login for $origin?",
                color = Palette.fg,
            )
            if (existing == null) {
                OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("Title") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text("Username") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            PasswordField(value = password, onValueChange = { password = it }, label = "Password")
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = { finish() }, modifier = Modifier.weight(1f)) { Text("Not now") }
                Button(
                    onClick = {
                        if (existing != null) {
                            pm.vault.updateEntry(existing.id, EntryInput.of(existing).copy(username = username, password = password))
                        } else {
                            val entry = pm.vault.createEntry(
                                EntryInput(
                                    title = title,
                                    username = username,
                                    password = password,
                                    url = save.pageUrl ?: UrlMatch.appUrl(save.packageName),
                                    notes = "",
                                    totp = "",
                                    folder = "",
                                    favorite = false,
                                ),
                            )
                            if (save.pageUrl == null) pm.settings.linkApp(save.packageName, entry.id)
                        }
                        pm.sync.syncSoon()
                        finish()
                    },
                    modifier = Modifier.weight(1f),
                ) { Text(if (existing != null) "Update" else "Save") }
            }
            Spacer(Modifier.height(4.dp))
        }
    }

    companion object {
        const val EXTRA_MODE = "mode"
        const val EXTRA_TOKEN = "token"
        const val MODE_UNLOCK = "unlock"
        const val MODE_PICK = "pick"
        const val MODE_SAVE = "save"

        private var requestCode = 0

        /** Autofill adds the screen's structure to this intent, so the PendingIntent must be mutable. */
        fun intentSender(context: Context, mode: String): IntentSender {
            val intent = Intent(context, AutofillActivity::class.java).putExtra(EXTRA_MODE, mode)
            val flags = PendingIntent.FLAG_CANCEL_CURRENT or
                (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            return PendingIntent.getActivity(context, ++requestCode, intent, flags).intentSender
        }

        fun saveIntentSender(context: Context, token: String): IntentSender {
            val intent = Intent(context, AutofillActivity::class.java)
                .putExtra(EXTRA_MODE, MODE_SAVE)
                .putExtra(EXTRA_TOKEN, token)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(
                context, ++requestCode, intent,
                PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            ).intentSender
        }
    }
}
