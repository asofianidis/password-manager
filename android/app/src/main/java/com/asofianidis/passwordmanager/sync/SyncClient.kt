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

/** POST /v1/attachments. `payload` is sealed [AttachmentRequest], AAD = pm:att-req:v1:<vaultId> */
@Serializable
data class AttachmentEnvelope(val vaultId: String, val keyId: String, val nonce: String, val payload: String)

/** An attachment file's contents: the attachment sealed with its own key, base64 */
@Serializable
data class AttachmentBlob(val id: String, val data: String)

@Serializable
data class AttachmentRequest(
    val nonce: String,
    val sentAt: Long,
    /** Files this device lacks and wants */
    val want: List<String> = emptyList(),
    /** Files this device has; the reply lists the ones the desktop lacks */
    val check: List<String> = emptyList(),
    /** Files the desktop asked for */
    val put: List<AttachmentBlob> = emptyList(),
)

/** Response `payload` is sealed AttachmentResponse, AAD = pm:att-res:v1:<vaultId>:<nonce> */
@Serializable
data class AttachmentResponse(
    val attachments: List<AttachmentBlob> = emptyList(),
    /** Wanted ids that can't be sent; wanted ids in neither list were held back for size */
    val missing: List<String> = emptyList(),
    /** Checked ids the desktop lacks */
    val need: List<String> = emptyList(),
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
    /** Attachment messages can carry several megabytes */
    private val attachmentHttp: OkHttpClient = http.newBuilder().callTimeout(120, TimeUnit.SECONDS).build()

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
        try {
            exchangeAttachments(host, port)
        } catch (e: Exception) {
            val reason = e.message ?: e.javaClass.simpleName
            throw SyncException("Synced entries, but files couldn't be transferred: $reason")
        }
        return SyncOutcome(received, sent)
    }

    /** Fetches the attachment files this phone lacks from a desktop, and sends the ones it lacks. */
    private fun exchangeAttachments(host: String, port: Int) {
        val ids = vault.attachmentRefs().keys.toList()
        var want = ids.filter { !vault.hasAttachmentBlob(it) }
        val check = ids.filter { vault.hasAttachmentBlob(it) }
        if (ids.isEmpty()) return

        // A desktop that predates attachments answers 404
        val first = attachmentRound(host, port, want = want.take(MAX_WANT), check = check) ?: return
        var reply: AttachmentResponse? = first
        while (reply != null) {
            for (blob in reply.attachments) vault.storeAttachmentBlob(blob.id, blob.data)
            val done = reply.attachments.map { it.id }.toSet() + reply.missing
            want = want.filter { it !in done }
            // Stop if the desktop sent nothing, so a misbehaving one can't keep us looping
            reply = if (want.isNotEmpty() && reply.attachments.isNotEmpty()) {
                attachmentRound(host, port, want = want.take(MAX_WANT))
            } else {
                null
            }
        }

        var batch = mutableListOf<AttachmentBlob>()
        var size = 0L
        for (id in first.need) {
            val data = vault.attachmentBlob(id) ?: continue
            if (batch.isNotEmpty() && size + data.length > ATTACHMENT_BATCH_BYTES) {
                attachmentRound(host, port, put = batch)
                batch = mutableListOf()
                size = 0
            }
            batch += AttachmentBlob(id, data)
            size += data.length
        }
        if (batch.isNotEmpty()) attachmentRound(host, port, put = batch)
    }

    /** One attachment round trip, sealed with the current vault key. Null if the desktop doesn't support it. */
    private fun attachmentRound(
        host: String,
        port: Int,
        want: List<String> = emptyList(),
        check: List<String> = emptyList(),
        put: List<AttachmentBlob> = emptyList(),
    ): AttachmentResponse? {
        val nonce = Crypto.nonce()
        val vaultId = vault.vaultId
        val key = vault.key
        val message = AttachmentRequest(nonce, System.currentTimeMillis(), want, check, put)
        val payload = Crypto.sealString(
            key,
            VaultJson.encodeToString(AttachmentRequest.serializer(), message),
            Aad.attachmentRequest(vaultId),
        )
        val body = VaultJson.encodeToString(
            AttachmentEnvelope.serializer(),
            AttachmentEnvelope(vaultId, vault.keyId, nonce, payload),
        )
        val text = try {
            request(url(host, port, "/v1/attachments"), body, attachmentHttp)
        } catch (e: PeerException) {
            if (e.status == 404) return null
            throw e
        }
        val response = VaultJson.decodeFromString(SyncResponse.serializer(), text)
        return try {
            VaultJson.decodeFromString(
                AttachmentResponse.serializer(),
                Crypto.openString(key, response.payload, Aad.attachmentResponse(vaultId, nonce)),
            )
        } catch (e: Exception) {
            throw SyncException("Device sent an invalid response")
        }
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

    private fun request(url: String, jsonBody: String?, client: OkHttpClient = http): String {
        val builder = Request.Builder().url(url)
        if (jsonBody != null) builder.post(jsonBody.toRequestBody(JSON))
        try {
            client.newCall(builder.build()).execute().use { response ->
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

        /** Files in one attachment message stop once their total passes this (one file always goes) */
        private const val ATTACHMENT_BATCH_BYTES = 12L * 1024 * 1024
        private const val MAX_WANT = 1000

        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .callTimeout(20, TimeUnit.SECONDS)
            .build()

        fun formatHost(host: String): String =
            if (host.contains(':') && !host.startsWith('[')) "[$host]" else host

        fun url(host: String, port: Int, path: String) = "http://${formatHost(host.trim())}:$port$path"
    }
}
