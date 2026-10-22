package com.asofianidis.passwordmanager.ui

import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.asofianidis.passwordmanager.R
import com.asofianidis.passwordmanager.SyncManager
import com.asofianidis.passwordmanager.SyncPeer
import com.asofianidis.passwordmanager.pm
import com.asofianidis.passwordmanager.sync.DEFAULT_SYNC_PORT
import com.asofianidis.passwordmanager.sync.PairResponse
import com.asofianidis.passwordmanager.vault.IncorrectPasswordException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

@Composable
private fun CenteredPage(content: @Composable () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        Spacer(Modifier.height(32.dp))
        Column(Modifier.widthIn(max = 440.dp), horizontalAlignment = Alignment.CenterHorizontally) { content() }
    }
}

@Composable
private fun Logo() {
    Image(painterResource(R.drawable.ic_logo), contentDescription = null, modifier = Modifier.size(72.dp))
}

@Composable
fun LockedScreen() {
    CenteredPage {
        Logo()
        Spacer(Modifier.height(16.dp))
        Text("Vault locked", style = MaterialTheme.typography.headlineSmall, color = Palette.bright)
        Spacer(Modifier.height(24.dp))
        UnlockPanel(onUnlocked = {})
    }
}

/** First run: pair with the desktop app, which holds the vault. */
@Composable
fun SetupScreen() {
    val pm = LocalContext.current.pm
    val scope = rememberCoroutineScope()
    var host by rememberSaveable { mutableStateOf("") }
    var port by rememberSaveable { mutableStateOf(DEFAULT_SYNC_PORT.toString()) }
    var code by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var progress by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    // The computer hands out its key header once per code, so keep it to retry a mistyped password
    var paired by remember { mutableStateOf<PairResponse?>(null) }
    val portNumber = port.toIntOrNull()?.takeIf { it in 1..65535 }
    val ready = host.isNotBlank() && portNumber != null && code.filter(Char::isDigit).length == 6 && password.isNotEmpty()

    fun pair() {
        if (!ready || progress != null) return
        error = null
        scope.launch {
            var peerId: String? = null
            try {
                progress = "Contacting your computer…"
                val response = paired ?: withContext(Dispatchers.IO) { pm.sync.client.pair(host.trim(), portNumber, code) }
                paired = response
                progress = "Unlocking…"
                val peer = SyncPeer(UUID.randomUUID().toString(), response.deviceName, host.trim(), portNumber)
                peerId = peer.id
                // Added first, so the sync that runs on unlock includes it
                pm.settings.setPeers { peers -> peers.filter { it.host != peer.host || it.port != peer.port } + peer }
                withContext(Dispatchers.Default) { pm.vault.join(response.vaultId, response.header, password) }
                password = ""
            } catch (e: Exception) {
                peerId?.let { id -> pm.settings.setPeers { peers -> peers.filter { it.id != id } } }
                error = when (e) {
                    is IncorrectPasswordException -> "Incorrect master password"
                    else -> SyncManager.describe(e)
                }
            } finally {
                progress = null
            }
        }
    }

    CenteredPage {
        Logo()
        Spacer(Modifier.height(16.dp))
        Text("Password Manager", style = MaterialTheme.typography.headlineSmall, color = Palette.bright)
        Spacer(Modifier.height(8.dp))
        Text(
            "Your vault lives on your computer. Pair this phone with it to use your logins here.",
            color = Palette.muted,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        Panel {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Step("1", "On your computer, open Password Manager → Sync and click Pair a new device.")
                Step("2", "Make sure this phone can reach it: the same Wi-Fi, or Tailscale on both.")
                Step("3", "Enter one of the addresses it shows, and the 6-digit code.")
            }
        }
        Spacer(Modifier.height(20.dp))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = host,
                    onValueChange = { host = it.trim(); paired = null },
                    label = { Text("Computer address") },
                    placeholder = { Text("100.101.102.103") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, autoCorrectEnabled = false),
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = port,
                    onValueChange = { port = it.filter(Char::isDigit).take(5); paired = null },
                    label = { Text("Port") },
                    singleLine = true,
                    isError = portNumber == null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
                    modifier = Modifier.width(100.dp),
                )
            }
            OutlinedTextField(
                value = code,
                onValueChange = { code = it.filter(Char::isDigit).take(6); paired = null },
                label = { Text("Pairing code") },
                singleLine = true,
                textStyle = MaterialTheme.typography.titleLarge.copy(fontFamily = FontFamily.Monospace, letterSpacing = 6.sp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            PasswordField(value = password, onValueChange = { password = it }, label = "Master password", imeAction = ImeAction.Go, onDone = ::pair)
            error?.let { Text(it, color = Palette.danger, style = MaterialTheme.typography.bodySmall) }
            Button(onClick = ::pair, enabled = ready && progress == null, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                if (progress != null) {
                    CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp), color = Palette.accentFg)
                    Spacer(Modifier.width(10.dp))
                    Text(progress!!)
                } else {
                    Text("Pair")
                }
            }
        }
    }
}

@Composable
private fun Step(number: String, text: String) {
    Row {
        Text(number, color = Palette.accent, fontFamily = FontFamily.Monospace, modifier = Modifier.width(22.dp))
        Text(text, color = Palette.fg, style = MaterialTheme.typography.bodyMedium)
    }
}
