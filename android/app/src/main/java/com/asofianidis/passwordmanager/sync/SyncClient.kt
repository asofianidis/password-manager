package com.asofianidis.passwordmanager.sync

import com.asofianidis.passwordmanager.vault.Aad
import com.asofianidis.passwordmanager.vault.Crypto
import com.asofianidis.passwordmanager.vault.Vault
import com.asofianidis.passwordmanager.vault.VaultEntry
import com.asofianidis.passwordmanager.vault.VaultJson
import com.asofianidis.passwordmanager.vault.VaultKeyHeader
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Client side of the peer-to-peer sync protocol (docs/SYNC_PROTOCOL.md). A phone can't keep a
 * listener running, so it only ever talks to desktops: it pairs with one, then sends its records
 * and merges what comes back.
 */
const val DEFAULT_SYNC_PORT = 47821

@Serializable
data class HelloResponse(val app: String, val protocol: Int, val deviceName: String, val vaultId: String? = null)

@Serializable
data class PairRequest(val code: String)

@Serializable
data class PairResponse(val vaultId: String, val header: VaultKeyHeader, val deviceName: String)

@Serializable
data class SyncRequest(val vaultId: String, val keyId: String, val nonce: String, val payload: String)

@Serializable
data class SyncResponse(val payload: String)

@Serializable
data class SyncMessage(
    val deviceId: String,
    val deviceName: String,
    val sentAt: Long,
    val nonce: String,
    val header: VaultKeyHeader,
    val entries: List<VaultEntry>,
)

/** A peer answered with an error status. */
class PeerException(val status: Int, message: String) : Exception(message)

class SyncException(message: String) : Exception(message)

data class SyncOutcome(val received: Int, val sent: Int)

class SyncClient(
    private val vault: Vault,
    private val deviceId: () -> String,
    private val deviceName: () -> String,
    private val http: OkHttpClient = defaultHttpClient(),
) {
    fun hello(host: String, port: Int): HelloResponse =
        VaultJson.decodeFromString(HelloResponse.serializer(), request(url(host, port, "/v1/hello"), null))

    /** Fetches the vault key header from a device that is in pairing mode. */
    fun pair(host: String, port: Int, code: String): PairResponse {
        val body = VaultJson.encodeToString(PairRequest.serializer(), PairRequest(code.filter(Char::isDigit)))
        return VaultJson.decodeFromString(PairResponse.serializer(), request(url(host, port, "/v1/pair"), body))
    }

    /** One full sync with a desktop: both sides hold identical records afterwards. */
    fun sync(peerName: String, host: String, port: Int): SyncOutcome {
        if (!vault.isUnlocked) throw SyncException("Unlock the vault to sync")
        val sent = vault.allRecords().size
        val message = try {
            exchange(host, port, vault.keyId, vault.key, null)
        } catch (e: PeerException) {
            if (e.status != 401) throw e
            if (forwardKey(host, port)) {
                throw SyncException(
                    "$peerName still has the old master password. It was sent the new key: enter " +
                        "the new master password there to finish.",
                )
            }
            if (vault.retiredKeys().isNotEmpty()) {
                throw SyncException("$peerName doesn't have the current vault key. Pair it again.")
            }
            throw e
        }
        val received = vault.applyRemote(message.entries, message.header)
        val peerKeyId = message.header.keyId
        if (peerKeyId != null && peerKeyId != vault.keyId && peerKeyId == vault.pendingKeyId) {
            throw SyncException(
                "The master password was changed on $peerName. Enter the new master password here to keep syncing.",
            )
        }
        return SyncOutcome(received, sent)
    }

    /** One request/response round trip, sealed with the given vault key. */
    private fun exchange(host: String, port: Int, keyId: String, key: ByteArray, entries: List<VaultEntry>?): SyncMessage {
        val nonce = Crypto.nonce()
        val vaultId = vault.vaultId
        val message = SyncMessage(
            deviceId = deviceId(),
            deviceName = deviceName(),
            sentAt = System.currentTimeMillis(),
            nonce = nonce,
            header = vault.keyHeader,
            entries = entries ?: vault.allRecords(),
        )
        val payload = Crypto.sealString(key, VaultJson.encodeToString(SyncMessage.serializer(), message), Aad.syncRequest(vaultId))
        val body = VaultJson.encodeToString(SyncRequest.serializer(), SyncRequest(vaultId, keyId, nonce, payload))
        val response = VaultJson.decodeFromString(SyncResponse.serializer(), request(url(host, port, "/v1/sync"), body))
        return try {
            VaultJson.decodeFromString(
                SyncMessage.serializer(),
                Crypto.openString(key, response.payload, Aad.syncResponse(vaultId, nonce)),
            )
        } catch (e: Exception) {
            throw SyncException("Device sent an invalid response")
        }
    }

    /**
     * After a master password change, a peer still on the old key can't read our requests. Send
     * it just the new header, sealed with the old key; its reply is ignored.
     */
    private fun forwardKey(host: String, port: Int): Boolean {
        for (retired in vault.retiredKeys().filter { !it.revoked }.take(3)) {
            try {
                exchange(host, port, retired.keyId, retired.key, emptyList())
                return true
            } catch (e: PeerException) {
                if (e.status != 401) throw e
            }
        }
        return false
    }

    private fun request(url: String, jsonBody: String?): String {
        val builder = Request.Builder().url(url)
        if (jsonBody != null) builder.post(jsonBody.toRequestBody(JSON))
        try {
            http.newCall(builder.build()).execute().use { response ->
                val text = response.body.string()
                if (!response.isSuccessful) {
                    val error = runCatching {
                        VaultJson.parseToJsonElement(text) as JsonObject
                    }.getOrNull()?.get("error")?.jsonPrimitive?.contentOrNull
                    throw PeerException(response.code, error ?: "Device responded with HTTP ${response.code}")
                }
                return text
            }
        } catch (e: IOException) {
            throw SyncException("Could not reach device (${e.message ?: e.javaClass.simpleName})")
        }
    }

    companion object {
        private val JSON = "application/json".toMediaType()

        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .callTimeout(20, TimeUnit.SECONDS)
            .build()

        fun formatHost(host: String): String =
            if (host.contains(':') && !host.startsWith('[')) "[$host]" else host

        fun url(host: String, port: Int, path: String) = "http://${formatHost(host.trim())}:$port$path"
    }
}
