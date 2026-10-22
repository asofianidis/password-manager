package com.asofianidis.passwordmanager

import android.content.Context
import android.os.Build
import androidx.core.content.edit
import com.asofianidis.passwordmanager.update.UpdateInfo
import com.asofianidis.passwordmanager.vault.VaultJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.SetSerializer
import kotlinx.serialization.builtins.serializer
import java.util.UUID

/** A desktop this phone syncs with. */
@Serializable
data class SyncPeer(
    val id: String,
    val name: String,
    val host: String,
    val port: Int,
    val lastSyncAt: Long? = null,
    val lastError: String? = null,
)

@Serializable
data class GeneratorOptions(
    val passphrase: Boolean = false,
    val length: Int = 20,
    val uppercase: Boolean = true,
    val lowercase: Boolean = true,
    val digits: Boolean = true,
    val symbols: Boolean = true,
    val excludeAmbiguous: Boolean = false,
    val words: Int = 5,
    val separator: String = "-",
    val capitalize: Boolean = true,
    val includeNumber: Boolean = true,
)

/** The vault key sealed by an Android Keystore key that only a biometric unlocks. */
data class BiometricBlob(val iv: String, val ciphertext: String, val keyId: String)

/** Device settings. Nothing secret lives here; the vault is in vault.json. */
class AppSettings(context: Context) {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    private val _peers = MutableStateFlow(readPeers())
    val peers: StateFlow<List<SyncPeer>> = _peers.asStateFlow()
    private val _revision = MutableStateFlow(0)
    /** Bumped whenever a setting changes, so screens can re-read */
    val revision: StateFlow<Int> = _revision.asStateFlow()

    val deviceId: String
        get() = prefs.getString("deviceId", null) ?: UUID.randomUUID().toString().also {
            prefs.edit { putString("deviceId", it) }
        }

    var deviceName: String
        get() = prefs.getString("deviceName", null) ?: Build.MODEL
        set(value) = update { putString("deviceName", value.trim().ifEmpty { Build.MODEL }) }

    /** 0 = never */
    var autoLockMinutes: Int
        get() = prefs.getInt("autoLockMinutes", 5)
        set(value) = update { putInt("autoLockMinutes", value) }

    var lockOnScreenOff: Boolean
        get() = prefs.getBoolean("lockOnScreenOff", false)
        set(value) = update { putBoolean("lockOnScreenOff", value) }

    /** Keeps the vault out of screenshots, screen recordings, and the recent apps preview */
    var blockScreenshots: Boolean
        get() = prefs.getBoolean("blockScreenshots", true)
        set(value) = update { putBoolean("blockScreenshots", value) }

    var clipboardClearSeconds: Int
        get() = prefs.getInt("clipboardClearSeconds", 30)
        set(value) = update { putInt("clipboardClearSeconds", value) }

    var generator: GeneratorOptions
        get() = prefs.getString("generator", null)
            ?.let { runCatching { VaultJson.decodeFromString(GeneratorOptions.serializer(), it) }.getOrNull() }
            ?: GeneratorOptions()
        set(value) = update { putString("generator", VaultJson.encodeToString(GeneratorOptions.serializer(), value)) }

    var biometric: BiometricBlob?
        get() {
            val iv = prefs.getString("bioIv", null) ?: return null
            val ct = prefs.getString("bioCiphertext", null) ?: return null
            val keyId = prefs.getString("bioKeyId", null) ?: return null
            return BiometricBlob(iv, ct, keyId)
        }
        set(value) = update {
            if (value == null) {
                remove("bioIv"); remove("bioCiphertext"); remove("bioKeyId")
            } else {
                putString("bioIv", value.iv); putString("bioCiphertext", value.ciphertext); putString("bioKeyId", value.keyId)
            }
        }

    /** Whether the vault screen already suggested turning on biometric unlock */
    var biometricOffered: Boolean
        get() = prefs.getBoolean("biometricOffered", false)
        set(value) = update { putBoolean("biometricOffered", value) }

    /** Shown once on the unlock screen, e.g. after biometric unlock was turned off. */
    var notice: String?
        get() = prefs.getString("notice", null)
        set(value) = update { if (value == null) remove("notice") else putString("notice", value) }

    /** Poll GitHub for new versions */
    var updateChecks: Boolean
        get() = prefs.getBoolean("updateChecks", true)
        set(value) = update { putBoolean("updateChecks", value) }

    /** Install new versions in the background instead of only notifying */
    var updateInstall: Boolean
        get() = prefs.getBoolean("updateInstall", true)
        set(value) = update { putBoolean("updateInstall", value) }

    var lastUpdateCheck: Long
        get() = prefs.getLong("lastUpdateCheck", 0)
        set(value) = prefs.edit { putLong("lastUpdateCheck", value) }

    /** What the last check found */
    var availableUpdate: UpdateInfo?
        get() = prefs.getString("availableUpdate", null)
            ?.let { runCatching { VaultJson.decodeFromString(UpdateInfo.serializer(), it) }.getOrNull() }
        set(value) = prefs.edit {
            if (value == null) remove("availableUpdate") else putString("availableUpdate", VaultJson.encodeToString(UpdateInfo.serializer(), value))
        }

    /** The version a notification was last posted for */
    var notifiedUpdate: String?
        get() = prefs.getString("notifiedUpdate", null)
        set(value) = prefs.edit { putString("notifiedUpdate", value) }

    /** The version handed to the installer, so the new version can tell it was updated */
    var installingUpdate: String?
        get() = prefs.getString("installingUpdate", null)
        set(value) = prefs.edit(commit = true) { if (value == null) remove("installingUpdate") else putString("installingUpdate", value) }

    // Apps the user chose a login for: package name → entry ids. Kept on this device only.
    private fun appLinks(): Map<String, Set<String>> = prefs.getString("appLinks", null)
        ?.let { runCatching { VaultJson.decodeFromString(linksSerializer, it) }.getOrNull() }
        ?: emptyMap()

    fun linkedEntries(packageName: String): Set<String> = appLinks()[packageName].orEmpty()

    fun linkApp(packageName: String, entryId: String) {
        val links = appLinks().toMutableMap()
        links[packageName] = links[packageName].orEmpty() + entryId
        update { putString("appLinks", VaultJson.encodeToString(linksSerializer, links)) }
    }

    fun unlinkApp(packageName: String, entryId: String) {
        val links = appLinks().toMutableMap()
        links[packageName] = links[packageName].orEmpty() - entryId
        if (links[packageName]!!.isEmpty()) links.remove(packageName)
        update { putString("appLinks", VaultJson.encodeToString(linksSerializer, links)) }
    }

    /** Apps linked to an entry, for its detail screen. */
    fun appsLinkedTo(entryId: String): List<String> = appLinks().filterValues { entryId in it }.keys.sorted()

    private fun readPeers(): List<SyncPeer> = prefs.getString("peers", null)
        ?.let { runCatching { VaultJson.decodeFromString(peersSerializer, it) }.getOrNull() }
        ?: emptyList()

    @Synchronized
    fun setPeers(transform: (List<SyncPeer>) -> List<SyncPeer>) {
        val next = transform(_peers.value)
        prefs.edit { putString("peers", VaultJson.encodeToString(peersSerializer, next)) }
        _peers.value = next
    }

    /** Forgets everything tied to the vault, when it is removed from this phone. */
    fun clearVaultState() {
        update {
            remove("peers"); remove("appLinks"); remove("bioIv"); remove("bioCiphertext"); remove("bioKeyId")
        }
        _peers.value = emptyList()
    }

    private companion object {
        // Here rather than with the code that uses them: _peers reads the peers while the
        // instance is still being constructed.
        val peersSerializer = ListSerializer(SyncPeer.serializer())
        val linksSerializer = MapSerializer(String.serializer(), SetSerializer(String.serializer()))
    }

    private fun update(block: android.content.SharedPreferences.Editor.() -> Unit) {
        prefs.edit(action = block)
        _revision.value++
    }
}
