@file:OptIn(ExperimentalMaterial3Api::class)

package com.asofianidis.passwordmanager.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.asofianidis.passwordmanager.Generator
import com.asofianidis.passwordmanager.pm
import com.asofianidis.passwordmanager.vault.CardDetails
import com.asofianidis.passwordmanager.vault.EntryInput
import com.asofianidis.passwordmanager.vault.EntryType
import com.asofianidis.passwordmanager.vault.IdentityDetails
import com.asofianidis.passwordmanager.vault.VaultEntry
import com.asofianidis.passwordmanager.vault.VaultStatus
import com.asofianidis.passwordmanager.vault.cardBrand
import com.asofianidis.passwordmanager.vault.formatCardNumber
import java.text.DateFormat
import java.util.Date

private val barColors @Composable get() = TopAppBarDefaults.topAppBarColors(containerColor = Palette.canvas)

@Composable
fun EntryScreen(id: String, status: VaultStatus) {
    val context = LocalContext.current
    val pm = context.pm
    val nav = LocalNavigator.current
    val entry = remember(status.revision) { pm.vault.find(id) }
    var confirmDelete by remember { mutableStateOf(false) }
    var linkedApps by remember { mutableStateOf(pm.settings.appsLinkedTo(id)) }
    if (entry == null) {
        nav.back()
        return
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
            when (entry.entryType) {
                EntryType.LOGIN -> LoginDetails(entry)
                EntryType.CARD -> CardDetailsPanel(entry.card ?: CardDetails(), entry.folder)
                EntryType.IDENTITY -> IdentityDetailsPanel(entry.identity ?: IdentityDetails(), entry.folder)
                EntryType.NOTE, EntryType.DOCUMENT -> if (entry.folder.isNotBlank()) Panel { DetailRow("Folder", entry.folder) }
            }
            if (entry.notes.isNotBlank()) {
                Panel {
                    Row(Modifier.padding(start = 16.dp, end = 4.dp, top = 12.dp, bottom = 12.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(if (entry.entryType == EntryType.NOTE) "Note" else "Notes", color = Palette.muted, style = MaterialTheme.typography.labelMedium)
                            Spacer(Modifier.height(4.dp))
                            Text(entry.notes, color = Palette.fg)
                        }
                        if (entry.entryType == EntryType.NOTE) {
                            IconButton(onClick = { pm.clipboard.copy("Note", entry.notes, true) }) {
                                Icon(Icons.Default.ContentCopy, contentDescription = "Copy note")
                            }
                        }
                    }
                }
            }
            AttachmentsPanel(entry.attachments.orEmpty())
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
                if (entry.isLogin) {
                    "Modified ${format.format(Date(entry.updatedAt))} · Password changed ${format.format(Date(entry.passwordUpdatedAt))}"
                } else {
                    "Modified ${format.format(Date(entry.updatedAt))}"
                },
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

@Composable
private fun LoginDetails(entry: VaultEntry) {
    val context = LocalContext.current
    var revealed by remember { mutableStateOf(false) }
    Panel {
        DetailRow("Username", entry.username.ifEmpty { null }) {
            CopyButton("Username", entry.username, sensitive = false)
        }
        HorizontalDivider(color = Palette.line)
        DetailRow("Password", if (entry.password.isEmpty()) null else if (revealed) entry.password else "••••••••••••", mono = revealed) {
            if (entry.password.isNotEmpty()) {
                RevealButton(revealed) { revealed = !revealed }
                CopyButton("Password", entry.password)
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
}

@Composable
private fun CardDetailsPanel(card: CardDetails, folder: String) {
    var revealed by remember { mutableStateOf(setOf<String>()) }
    fun toggle(key: String) {
        revealed = if (key in revealed) revealed - key else revealed + key
    }
    fun masked(key: String, value: String) = if (key in revealed) value else "•".repeat(value.length.coerceIn(3, 8))

    Panel {
        DetailRow("Cardholder", card.cardholder.ifEmpty { null }) {
            if (card.cardholder.isNotEmpty()) CopyButton("Cardholder", card.cardholder, sensitive = false)
        }
        HorizontalDivider(color = Palette.line)
        val number = card.number
        DetailRow(
            cardBrand(number) ?: "Card number",
            when {
                number.isEmpty() -> null
                "number" in revealed -> formatCardNumber(number)
                else -> "•••• ${number.takeLast(4)}"
            },
            mono = true,
        ) {
            if (number.isNotEmpty()) {
                RevealButton("number" in revealed) { toggle("number") }
                CopyButton("Card number", number)
            }
        }
        HorizontalDivider(color = Palette.line)
        DetailRow("Expires", card.expiry.ifEmpty { null }, mono = true) {
            if (card.expiry.isNotEmpty()) CopyButton("Expiry", card.expiry, sensitive = false)
        }
        HorizontalDivider(color = Palette.line)
        DetailRow("Security code", card.cvv.ifEmpty { null }?.let { masked("cvv", it) }, mono = true) {
            if (card.cvv.isNotEmpty()) {
                RevealButton("cvv" in revealed) { toggle("cvv") }
                CopyButton("Security code", card.cvv)
            }
        }
        if (card.pin.isNotEmpty()) {
            HorizontalDivider(color = Palette.line)
            DetailRow("PIN", masked("pin", card.pin), mono = true) {
                RevealButton("pin" in revealed) { toggle("pin") }
                CopyButton("PIN", card.pin)
            }
        }
        if (folder.isNotBlank()) {
            HorizontalDivider(color = Palette.line)
            DetailRow("Folder", folder)
        }
    }
}

@Composable
private fun IdentityDetailsPanel(identity: IdentityDetails, folder: String) {
    Panel {
        DetailRow("Type", IdentityDetails.kindLabel(identity.kind))
        HorizontalDivider(color = Palette.line)
        DetailRow("Full name", identity.fullName.ifEmpty { null }) {
            if (identity.fullName.isNotEmpty()) CopyButton("Full name", identity.fullName, sensitive = false)
        }
        HorizontalDivider(color = Palette.line)
        DetailRow("Number", identity.number.ifEmpty { null }, mono = true) {
            if (identity.number.isNotEmpty()) CopyButton("ID number", identity.number)
        }
        listOf(
            "Issued by" to identity.issuer,
            "Issued" to identity.issuedOn,
            "Expires" to identity.expiresOn,
            "Date of birth" to identity.birthDate,
        ).filter { it.second.isNotEmpty() }.forEach { (label, value) ->
            HorizontalDivider(color = Palette.line)
            DetailRow(label, value)
        }
        if (folder.isNotBlank()) {
            HorizontalDivider(color = Palette.line)
            DetailRow("Folder", folder)
        }
    }
}

@Composable
private fun CopyButton(label: String, value: String, sensitive: Boolean = true) {
    val pm = LocalContext.current.pm
    IconButton(onClick = { pm.clipboard.copy(label, value, sensitive) }) {
        Icon(Icons.Default.ContentCopy, contentDescription = "Copy ${label.lowercase()}")
    }
}

@Composable
private fun RevealButton(revealed: Boolean, onToggle: () -> Unit) {
    IconButton(onClick = onToggle) {
        Icon(if (revealed) Icons.Default.VisibilityOff else Icons.Default.Visibility, contentDescription = if (revealed) "Hide" else "Show")
    }
}

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

/** Edits an entry, or creates one of [newType] when [id] is null. */
@Composable
fun EditScreen(id: String?, newType: EntryType = EntryType.LOGIN) {
    val context = LocalContext.current
    val pm = context.pm
    val nav = LocalNavigator.current
    val existing = remember { id?.let { pm.vault.find(it) } }
    val initial = remember { existing?.let(EntryInput::of) ?: EntryInput.empty(newType) }
    val type = initial.type
    val generator = remember { Generator(context) }
    var title by rememberSaveable { mutableStateOf(initial.title) }
    var username by rememberSaveable { mutableStateOf(initial.username) }
    var password by rememberSaveable { mutableStateOf(initial.password) }
    var url by rememberSaveable { mutableStateOf(initial.url) }
    var folder by rememberSaveable { mutableStateOf(initial.folder) }
    var notes by rememberSaveable { mutableStateOf(initial.notes) }
    var totp by rememberSaveable { mutableStateOf(initial.totp) }
    var favorite by rememberSaveable { mutableStateOf(initial.favorite) }
    var cardholder by rememberSaveable { mutableStateOf(initial.card.cardholder) }
    var cardNumber by rememberSaveable { mutableStateOf(initial.card.number) }
    var expiry by rememberSaveable { mutableStateOf(initial.card.expiry) }
    var cvv by rememberSaveable { mutableStateOf(initial.card.cvv) }
    var pin by rememberSaveable { mutableStateOf(initial.card.pin) }
    var kind by rememberSaveable { mutableStateOf(initial.identity.kind) }
    var fullName by rememberSaveable { mutableStateOf(initial.identity.fullName) }
    var idNumber by rememberSaveable { mutableStateOf(initial.identity.number) }
    var issuer by rememberSaveable { mutableStateOf(initial.identity.issuer) }
    var issuedOn by rememberSaveable { mutableStateOf(initial.identity.issuedOn) }
    var expiresOn by rememberSaveable { mutableStateOf(initial.identity.expiresOn) }
    var birthDate by rememberSaveable { mutableStateOf(initial.identity.birthDate) }
    // Not saveable: attachments added in this session are only kept until the vault locks anyway
    var attachments by remember { mutableStateOf(initial.attachments) }

    fun save() {
        val input = EntryInput(
            title, username, password, url, notes, totp, folder, favorite,
            type = type,
            card = CardDetails(cardholder, cardNumber, expiry, cvv, pin),
            identity = IdentityDetails(kind, fullName, idNumber, issuer, issuedOn, expiresOn, birthDate),
            attachments = attachments,
        )
        val saved = if (existing != null) pm.vault.updateEntry(existing.id, input) else pm.vault.createEntry(input)
        pm.sync.syncSoon()
        if (existing != null) nav.back() else nav.replace(Route(Route.ENTRY, saved.id))
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (existing != null) "Edit ${type.one.lowercase()}" else "New ${type.one.lowercase()}") },
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
            val names = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next)
            val plain = KeyboardOptions(autoCorrectEnabled = false, imeAction = ImeAction.Next)
            val digits = plain.copy(keyboardType = KeyboardType.Number)
            val full = Modifier.fillMaxWidth()

            @Composable
            fun field(value: String, onChange: (String) -> Unit, label: String, options: KeyboardOptions = plain, placeholder: String? = null, mono: Boolean = false) =
                OutlinedTextField(
                    value, onChange, label = { Text(label) }, singleLine = true, keyboardOptions = options,
                    placeholder = placeholder?.let { { Text(it) } },
                    textStyle = if (mono) MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace) else MaterialTheme.typography.bodyLarge,
                    modifier = full,
                )

            field(title, { title = it }, if (type == EntryType.CARD) "Name" else "Title", words, placeholder = when (type) {
                EntryType.CARD -> "Everyday Visa"
                EntryType.IDENTITY -> "Passport"
                else -> null
            })
            when (type) {
                EntryType.LOGIN -> {
                    field(username, { username = it }, "Username or email", plain.copy(keyboardType = KeyboardType.Email))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        PasswordField(password, { password = it }, "Password", modifier = Modifier.weight(1f), imeAction = ImeAction.Next)
                        IconButton(onClick = { password = generator.generate(pm.settings.generator) }) {
                            Icon(Icons.Default.Autorenew, contentDescription = "Generate password", tint = Palette.accent)
                        }
                    }
                    field(url, { url = it }, "Website", plain.copy(keyboardType = KeyboardType.Uri), placeholder = "example.com")
                }
                EntryType.CARD -> {
                    field(cardholder, { cardholder = it }, "Cardholder name", names)
                    field(cardNumber, { cardNumber = it.filter(Char::isDigit).take(19) }, "Card number", digits, mono = true)
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedTextField(expiry, { expiry = it.take(7) }, label = { Text("Expiry") }, placeholder = { Text("MM/YY") }, singleLine = true,
                            keyboardOptions = plain, modifier = Modifier.weight(1f))
                        PasswordField(cvv, { cvv = it.take(4) }, "CVV", modifier = Modifier.weight(1f), imeAction = ImeAction.Next)
                    }
                    PasswordField(pin, { pin = it.take(12) }, "PIN (optional)", imeAction = ImeAction.Next)
                }
                EntryType.IDENTITY -> {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        IdentityDetails.IDENTITY_KINDS.forEach { k ->
                            FilterChip(selected = kind == k, onClick = { kind = k }, label = { Text(IdentityDetails.kindLabel(k)) })
                        }
                    }
                    field(fullName, { fullName = it }, "Full name", names)
                    field(idNumber, { idNumber = it }, "Document number", plain, mono = true)
                    field(issuer, { issuer = it }, "Issued by", names, placeholder = "Country or state")
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedTextField(issuedOn, { issuedOn = it }, label = { Text("Issued") }, placeholder = { Text("YYYY-MM-DD") }, singleLine = true,
                            keyboardOptions = plain, modifier = Modifier.weight(1f))
                        OutlinedTextField(expiresOn, { expiresOn = it }, label = { Text("Expires") }, placeholder = { Text("YYYY-MM-DD") }, singleLine = true,
                            keyboardOptions = plain, modifier = Modifier.weight(1f))
                    }
                    field(birthDate, { birthDate = it }, "Date of birth", plain, placeholder = "YYYY-MM-DD")
                }
                EntryType.NOTE, EntryType.DOCUMENT -> Unit
            }
            field(folder, { folder = it }, "Folder", words)
            if (type == EntryType.LOGIN) {
                field(totp, { totp = it }, "Two-factor secret", plain, placeholder = "otpauth://… or base32")
            }
            OutlinedTextField(
                notes, { notes = it },
                label = { Text(if (type == EntryType.NOTE) "Note" else "Notes") },
                supportingText = if (type == EntryType.NOTE) {
                    { Text("Lines like \"Street: 1 Main St\" can be filled into websites from the browser extension.") }
                } else null,
                minLines = if (type == EntryType.NOTE) 8 else 3,
                modifier = full,
            )
            AttachmentsEditor(attachments) { attachments = it }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable { favorite = !favorite }) {
                Text("Favorite", color = Palette.fg, modifier = Modifier.weight(1f))
                Switch(checked = favorite, onCheckedChange = { favorite = it })
            }
            Spacer(Modifier.width(1.dp))
        }
    }
}
